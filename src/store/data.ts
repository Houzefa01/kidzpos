import { create } from "zustand";
import { persist } from "zustand/middleware";
import { broadcastSync } from "@/lib/sync";
import { BackupSchema } from "@/lib/schemas";
import { pushMutation } from "@/store/backend";
import { useCustomers } from "@/store/customers";

export interface Store {
  id: string;
  name: string;
  location: string;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  storeId: string;
  category?: string;
  sku: string;
  createdAt: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

export type PaymentMode = "CASH" | "CARD" | "MIXED" | "MOBILE_MONEY";
export type SaleCurrency = "AR" | "EUR";

/** Libellé FR uniformisé pour l'affichage. Source unique pour POS, Sales, PDF. */
export function paymentLabel(mode: PaymentMode): string {
  switch (mode) {
    case "CASH": return "Espèces";
    case "CARD": return "Carte";
    case "MIXED": return "Mixte";
    case "MOBILE_MONEY": return "Mobile Money";
  }
}

export interface Sale {
  id: string;
  seq: number;
  storeId: string;
  userId: string;
  userName: string;
  items: SaleItem[];
  subtotal: number;
  tax: number;
  taxRate: number;
  discount: number;
  total: number;
  date: string;
  customerId?: string;
  customerName?: string;
  pointsEarned: number;
  pointsRedeemed: number;
  paymentMode: PaymentMode;
  amountPaid?: number;
  change?: number;
  refundedFrom?: string;
  currency: SaleCurrency;
}

export type StockMoveType = "IN" | "OUT" | "ADJUST" | "TRANSFER" | "SALE" | "REFUND";

export interface StockMove {
  id: string;
  date: string;
  productId: string;
  productName: string;
  storeId: string;
  toStoreId?: string; // pour TRANSFER
  type: StockMoveType;
  delta: number; // signé
  reason?: string;
  userId?: string;
  userName?: string;
}

export interface ParkedCart {
  id: string;
  label: string;
  storeId: string;
  userId: string;
  items: SaleItem[];
  customerId?: string;
  customerName?: string;
  createdAt: string;
}

interface DataState {
  stores: Store[];
  products: Product[];
  sales: Sale[];
  moves: StockMove[];
  parked: ParkedCart[];
  saleSeq: Record<string, number>;
  addProduct: (p: Omit<Product, "id" | "createdAt">) => { ok: boolean; error?: string; product?: Product };
  updateProduct: (id: string, patch: Partial<Product>) => void;
  deleteProduct: (id: string) => void;
  bulkImportProducts: (rows: Omit<Product, "id" | "createdAt">[]) => { added: number; skipped: number };
  addSale: (s: Omit<Sale, "id" | "date" | "seq">) => Sale;
  refundSale: (id: string, by: { userId: string; userName: string }) => { ok: boolean; error?: string; refund?: Sale };
  adjustStock: (productId: string, delta: number, reason: string, by?: { userId: string; userName: string }) => { ok: boolean; error?: string };
  transferStock: (productId: string, fromStoreId: string, toStoreId: string, qty: number, by?: { userId: string; userName: string }) => { ok: boolean; error?: string };
  parkCart: (cart: Omit<ParkedCart, "id" | "createdAt">) => void;
  unparkCart: (id: string) => ParkedCart | undefined;
  addStore: (s: Omit<Store, "id">) => { ok: boolean; error?: string; store?: Store };
  updateStore: (id: string, patch: Partial<Store>) => void;
  deleteStore: (id: string) => { ok: boolean; error?: string };
  exportAll: () => string;
  importAll: (json: string) => { ok: boolean; error?: string };
  resetAll: () => void;
}

// État initial vide : le backend Postgres est l'unique source de vérité.
// `syncBackend` peuple stores/products/sales/customers au démarrage et via SSE.
export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      stores: [],
      products: [],
      sales: [],
      moves: [],
      parked: [],
      saleSeq: {},

      addProduct: (p) => {
        const existing = get().products.find(
          (x) => x.storeId === p.storeId && x.sku.toLowerCase() === p.sku.toLowerCase()
        );
        if (existing) return { ok: false, error: "Référence (SKU) déjà utilisée dans ce magasin" };
        const product: Product = { ...p, id: `p${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, createdAt: new Date().toISOString() };
        set((s) => ({ products: [...s.products, product] }));
        broadcastSync("kidzpos-data");
        pushMutation("/api/products", "POST", product, `product:${product.id}`);
        return { ok: true, product };
      },
      updateProduct: (id, patch) => {
        set((s) => ({ products: s.products.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        broadcastSync("kidzpos-data");
        const updated = get().products.find((p) => p.id === id);
        if (updated) pushMutation(`/api/products/${id}`, "PUT", updated, `product:${id}`);
      },
      deleteProduct: (id) => {
        set((s) => ({ products: s.products.filter((x) => x.id !== id) }));
        broadcastSync("kidzpos-data");
        pushMutation(`/api/products/${id}`, "DELETE", undefined, `product:${id}`);
      },
      bulkImportProducts: (rows) => {
        let added = 0, skipped = 0;
        const now = Date.now();
        set((s) => {
          const products = [...s.products];
          rows.forEach((r, i) => {
            const dup = products.find((x) => x.storeId === r.storeId && x.sku.toLowerCase() === r.sku.toLowerCase());
            if (dup) { skipped++; return; }
            products.push({ ...r, id: `p${now}-${i}`, createdAt: new Date().toISOString() });
            added++;
          });
          return { products };
        });
        broadcastSync("kidzpos-data");
        return { added, skipped };
      },
      addSale: (sale) => {
        const seq = (get().saleSeq[sale.storeId] ?? 0) + 1;
        const full: Sale = { ...sale, id: `sale-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, date: new Date().toISOString(), seq };
        set((s) => {
          const products = s.products.map((p) => {
            const it = sale.items.find((i) => i.productId === p.id);
            return it ? { ...p, stock: Math.max(0, p.stock - it.quantity) } : p;
          });
          const moves: StockMove[] = sale.items.map((it) => ({
            id: `m${Date.now()}-${it.productId}`,
            date: full.date,
            productId: it.productId,
            productName: it.name,
            storeId: sale.storeId,
            type: "SALE",
            delta: -it.quantity,
            userId: sale.userId,
            userName: sale.userName,
            reason: `Vente #${seq}`,
          }));
          return {
            sales: [full, ...s.sales],
            products,
            moves: [...moves, ...s.moves].slice(0, 1000),
            saleSeq: { ...s.saleSeq, [sale.storeId]: seq },
          };
        });
        broadcastSync("kidzpos-data");
        // Backend : POST checkout (le serveur recalcule total + décrémente stock DB).
        // I8-FE : clientSaleId = id local → idempotence du replay outbox après reconnexion
        // (le backend renvoie la vente existante au lieu d'en créer une nouvelle).
        pushMutation("/api/sales/checkout", "POST", {
          clientSaleId: full.id,
          storeId: sale.storeId,
          items: sale.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          discount: sale.discount,
          paymentMode: sale.paymentMode,
          amountPaid: sale.amountPaid,
          customerId: sale.customerId,
          pointsRedeemed: sale.pointsRedeemed,
          currency: sale.currency,
        }, `sale:${full.id}`);
        return full;
      },
      refundSale: (id, by) => {
        const original = get().sales.find((s) => s.id === id);
        if (!original) return { ok: false, error: "Vente introuvable" };
        if (original.refundedFrom) return { ok: false, error: "C'est déjà un remboursement" };
        if (get().sales.some((s) => s.refundedFrom === id)) return { ok: false, error: "Déjà remboursée" };
        const seq = (get().saleSeq[original.storeId] ?? 0) + 1;
        const refund: Sale = {
          ...original,
          id: `sale-${Date.now()}-r`,
          seq,
          date: new Date().toISOString(),
          items: original.items.map((i) => ({ ...i })),
          subtotal: -original.subtotal,
          tax: -original.tax,
          discount: -original.discount,
          total: -original.total,
          pointsEarned: -original.pointsEarned,
          pointsRedeemed: -original.pointsRedeemed,
          amountPaid: -(original.amountPaid ?? original.total),
          change: 0,
          userId: by.userId,
          userName: by.userName,
          refundedFrom: original.id,
        };
        set((s) => {
          // Réintégrer le stock
          const products = s.products.map((p) => {
            const it = original.items.find((i) => i.productId === p.id);
            return it ? { ...p, stock: p.stock + it.quantity } : p;
          });
          const moves: StockMove[] = original.items.map((it) => ({
            id: `m${Date.now()}-r-${it.productId}`,
            date: refund.date,
            productId: it.productId,
            productName: it.name,
            storeId: original.storeId,
            type: "REFUND",
            delta: it.quantity,
            userId: by.userId,
            userName: by.userName,
            reason: `Remboursement vente #${original.seq}`,
          }));
          return {
            sales: [refund, ...s.sales],
            products,
            moves: [...moves, ...s.moves].slice(0, 1000),
            saleSeq: { ...s.saleSeq, [original.storeId]: seq },
          };
        });
        broadcastSync("kidzpos-data");
        // Retirer les points gagnés lors de la vente originale
        if (original.customerId && original.pointsEarned > 0) {
          useCustomers.getState().applyPurchase(
            original.customerId,
            -original.total,
            -original.pointsEarned,
            0
          );
        }
        pushMutation("/api/sales/refund", "POST", { saleId: id }, `refund:${id}`);
        return { ok: true, refund };
      },
      adjustStock: (productId, delta, reason, by) => {
        const p = get().products.find((x) => x.id === productId);
        if (!p) return { ok: false, error: "Produit introuvable" };
        const newStock = p.stock + delta;
        if (newStock < 0) return { ok: false, error: "Stock négatif interdit" };
        const move: StockMove = {
          id: `m${Date.now()}`,
          date: new Date().toISOString(),
          productId, productName: p.name, storeId: p.storeId,
          type: delta > 0 ? "IN" : delta < 0 ? "OUT" : "ADJUST",
          delta, reason, userId: by?.userId, userName: by?.userName,
        };
        set((s) => ({
          products: s.products.map((x) => (x.id === productId ? { ...x, stock: newStock } : x)),
          moves: [move, ...s.moves].slice(0, 1000),
        }));
        broadcastSync("kidzpos-data");
        pushMutation("/api/stock/adjust", "POST", { productId, delta, reason }, `adjust:${productId}:${Date.now()}`);
        return { ok: true };
      },
      transferStock: (productId, fromStoreId, toStoreId, qty, by) => {
        if (qty <= 0) return { ok: false, error: "Quantité invalide" };
        if (fromStoreId === toStoreId) return { ok: false, error: "Même magasin" };
        const src = get().products.find((p) => p.id === productId && p.storeId === fromStoreId);
        if (!src) return { ok: false, error: "Produit introuvable dans le magasin source" };
        if (src.stock < qty) return { ok: false, error: "Stock source insuffisant" };
        // Trouver ou créer la version destination par SKU
        let dst = get().products.find((p) => p.storeId === toStoreId && p.sku.toLowerCase() === src.sku.toLowerCase());
        const now = new Date().toISOString();
        set((s) => {
          let products = s.products.map((p) => (p.id === src.id ? { ...p, stock: p.stock - qty } : p));
          if (dst) {
            products = products.map((p) => (p.id === dst!.id ? { ...p, stock: p.stock + qty } : p));
          } else {
            const id = `p${Date.now()}-t`;
            products = [...products, { ...src, id, storeId: toStoreId, stock: qty, createdAt: now }];
            dst = products[products.length - 1];
          }
          const moveOut: StockMove = {
            id: `m${Date.now()}-out`, date: now, productId: src.id, productName: src.name,
            storeId: fromStoreId, toStoreId, type: "TRANSFER", delta: -qty,
            reason: `Transfert vers ${toStoreId}`, userId: by?.userId, userName: by?.userName,
          };
          return { products, moves: [moveOut, ...s.moves].slice(0, 1000) };
        });
        broadcastSync("kidzpos-data");
        pushMutation("/api/stock/transfer", "POST", { productId, targetStoreId: toStoreId, quantity: qty }, `transfer:${productId}:${Date.now()}`);
        return { ok: true };
      },
      parkCart: (cart) => {
        const full: ParkedCart = { ...cart, id: `pk${Date.now()}`, createdAt: new Date().toISOString() };
        set((s) => ({ parked: [full, ...s.parked].slice(0, 20) }));
        broadcastSync("kidzpos-data");
      },
      unparkCart: (id) => {
        const c = get().parked.find((x) => x.id === id);
        if (c) {
          set((s) => ({ parked: s.parked.filter((x) => x.id !== id) }));
          broadcastSync("kidzpos-data");
        }
        return c;
      },
      addStore: (input) => {
        const name = input.name?.trim();
        const location = input.location?.trim() ?? "";
        if (!name) return { ok: false, error: "Nom requis" };
        if (get().stores.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
          return { ok: false, error: "Un magasin porte déjà ce nom" };
        }
        const id = `store-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const store: Store = { id, name, location };
        set((s) => ({ stores: [...s.stores, store] }));
        broadcastSync("kidzpos-data");
        pushMutation("/api/stores", "POST", store, `store:${id}`);
        return { ok: true, store };
      },
      updateStore: (id, patch) => {
        set((s) => ({ stores: s.stores.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
        broadcastSync("kidzpos-data");
        const updated = get().stores.find((s) => s.id === id);
        if (updated) pushMutation(`/api/stores/${id}`, "PUT", updated, `store:${id}`);
      },
      deleteStore: (id) => {
        if (get().products.some((p) => p.storeId === id)) {
          return { ok: false, error: "Magasin contient des produits — supprimer ou transférer d'abord" };
        }
        if (get().sales.some((s) => s.storeId === id)) {
          return { ok: false, error: "Magasin a un historique de ventes — suppression bloquée" };
        }
        set((s) => ({ stores: s.stores.filter((x) => x.id !== id) }));
        broadcastSync("kidzpos-data");
        pushMutation(`/api/stores/${id}`, "DELETE", undefined, `store:${id}`);
        return { ok: true };
      },
      exportAll: () => JSON.stringify({
        stores: get().stores, products: get().products, sales: get().sales,
      }, null, 2),
      importAll: (json) => {
        try {
          const data = JSON.parse(json);
          const parsed = BackupSchema.safeParse(data);
          if (!parsed.success) return { ok: false, error: "Format invalide" };
          const seq: Record<string, number> = {};
          for (const s of parsed.data.sales) seq[s.storeId] = Math.max(seq[s.storeId] ?? 0, s.seq ?? 0);
          set({ stores: parsed.data.stores, products: parsed.data.products, sales: parsed.data.sales, saleSeq: seq });
          broadcastSync("kidzpos-data");
          return { ok: true };
        } catch (e: unknown) { return { ok: false, error: e instanceof Error ? e.message : "Erreur" }; }
      },
      resetAll: () => {
        // Vide l'état local : le prochain syncBackend réhydratera depuis Postgres.
        set({ stores: [], products: [], sales: [], moves: [], parked: [], saleSeq: {} });
        broadcastSync("kidzpos-data");
      },
    }),
    {
      name: "kidzpos-data",
      version: 5,
      migrate: (persisted: unknown, version) => {
        if (!persisted || typeof persisted !== "object") return persisted;
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          state.products = ((state.products ?? []) as Record<string, unknown>[]).map((p) => ({
            ...p,
            category: (p.category as string) || undefined,
            createdAt: (p.createdAt as string) ?? new Date().toISOString(),
          }));
          state.sales = ((state.sales ?? []) as Record<string, unknown>[]).map((s) => ({
            ...s,
            taxRate: (s.taxRate as number) ?? 20,
            pointsEarned: (s.pointsEarned as number) ?? 0,
            pointsRedeemed: (s.pointsRedeemed as number) ?? 0,
            paymentMode: (s.paymentMode as string) ?? "CASH",
          }));
        }
        if (version < 3) {
          const seq: Record<string, number> = {};
          state.sales = ((state.sales ?? []) as Record<string, unknown>[]).map((s) => {
            const storeId = (s as Record<string, unknown>).storeId as string;
            seq[storeId] = (seq[storeId] ?? 0) + 1;
            return { ...(s as Record<string, unknown>), seq: ((s as Record<string, unknown>).seq as number) ?? seq[storeId] };
          });
          state.saleSeq = seq;
          state.moves = (state.moves ?? []) as unknown[];
          state.parked = (state.parked ?? []) as unknown[];
        }
        if (version < 4) {
          // Suppression des données seed de l'ère SQLite. Postgres est désormais
          // la source de vérité, syncBackend repeuplera au prochain démarrage.
          state.stores = [];
          state.products = [];
          state.sales = [];
          state.moves = [];
          state.parked = [];
          state.saleSeq = {};
        }
        if (version < 5) {
          // Bascule devise canonique EUR → AR (V5 backend). Toutes les valeurs
          // monétaires persistées étaient en EUR — on wipe pour éviter que des
          // produits "10 €" soient interprétés comme "10 Ar" au réaffichage.
          state.stores = [];
          state.products = [];
          state.sales = [];
          state.moves = [];
          state.parked = [];
          state.saleSeq = {};
        }
        return state;
      },
    }
  )
);
