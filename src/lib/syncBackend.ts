import { api, tokenStore } from "@/lib/apiClient";
import { useAuth } from "@/store/auth";
import { useData } from "@/store/data";
import { useCustomers } from "@/store/customers";
import { useSettings } from "@/store/settings";
import { useBackend } from "@/store/backend";
import { startSse } from "@/lib/sse";
import {
  StoreSchema,
  ProductSchema,
  SaleSchema,
  CustomerSchema,
  SettingsSchema,
  UserSchema,
} from "@/lib/schemas";
import { z } from "zod";

let _hydrating = false;
let _needsRehydrate = false;

export async function hydrateFromBackend(): Promise<{ ok: boolean; error?: string }> {
  if (!tokenStore.get()) return { ok: false, error: "Non authentifié" };
  if (_hydrating) {
    // Marquer qu'une nouvelle hydratation est requise après celle en cours
    _needsRehydrate = true;
    return { ok: false, error: "Hydratation déjà en cours — re-planifiée" };
  }
  _hydrating = true;
  try {
    const role = useAuth.getState().user?.role;
    const userFetch = role === "ADMIN"
      ? api<unknown>("/api/users").catch(() => null)   // non-bloquant : l'admin peut continuer même si /users plante
      : Promise.resolve(null);

    const [rawStores, rawProducts, rawSales, rawCustomers, rawSettings, rawUsers] = await Promise.all([
      api<unknown>("/api/stores"),
      api<unknown>("/api/products"),
      api<unknown>("/api/sales"),
      api<unknown>("/api/customers"),
      api<unknown>("/api/settings"),
      userFetch,
    ]);

    const stores = z.array(StoreSchema).parse(rawStores);
    const products = z.array(ProductSchema).parse(rawProducts);
    const sales = z.array(SaleSchema).parse(rawSales);
    const customers = z.array(CustomerSchema).parse(rawCustomers);
    const settings = SettingsSchema.parse(rawSettings);

    const saleSeq: Record<string, number> = {};
    for (const s of sales) saleSeq[s.storeId] = Math.max(saleSeq[s.storeId] ?? 0, s.seq ?? 0);

    useData.setState({ stores, products, sales, saleSeq });
    useCustomers.setState({ customers });
    useSettings.setState({ settings });

    if (rawUsers !== null) {
      // storeId arrive en `null` côté backend → on convertit en `null` strict pour le type User.
      const users = z.array(UserSchema).parse(rawUsers).map((u) => ({
        ...u,
        storeId: u.storeId ?? null,
      }));
      useAuth.setState({ users });
    }

    useBackend.setState({ lanReachable: true, lastSync: Date.now() });
    startSse();
    return { ok: true };
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status;
    if (status === 401 || status === 403) {
      tokenStore.set(null);
      return { ok: false, error: "Session expirée" };
    }
    useBackend.setState({ lanReachable: false });
    return { ok: false, error: e instanceof Error ? e.message : "Sync échouée" };
  } finally {
    _hydrating = false;
    // Si un event SSE a tenté d'hydrater pendant qu'on tournait → relancer
    if (_needsRehydrate) {
      _needsRehydrate = false;
      setTimeout(() => hydrateFromBackend().catch(() => {}), 100);
    }
  }
}
