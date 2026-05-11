import { useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useAuth } from "@/store/auth";
import { useData, Product, SaleItem, Sale, PaymentMode } from "@/store/data";
import { useSettings } from "@/store/settings";
import { useCustomers, Customer } from "@/store/customers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CategoryCombobox } from "@/components/CategoryCombobox";
import { CustomerPicker } from "@/components/CustomerPicker";
import { Plus, Minus, Trash2, Receipt as ReceiptIcon, Banknote, Printer, Star, Keyboard, ScanLine, Pause, Play, FileText } from "lucide-react";
import { toast } from "sonner";
import { downloadReceiptPdf } from "@/lib/pdf";
import { useFormatMoney } from "@/lib/money";

export default function POS() {
  const { user } = useAuth();
  const fmt = useFormatMoney();
  const { products, stores, addSale, addProduct, parked, parkCart, unparkCart } = useData();
  const { settings } = useSettings();
  const { applyPurchase } = useCustomers();
  const isAdmin = user?.role === "ADMIN";
  const [activeStore, setActiveStore] = useState<string>(user?.storeId ?? "s1");
  const storeId = isAdmin ? activeStore : (user?.storeId ?? "s1");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 100);
  const [discount, setDiscount] = useState(0);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(0);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("CASH");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  // Devise affichée au client pour CETTE vente. Default = devise globale.
  const [saleCurrency, setSaleCurrency] = useState<"AR" | "EUR">(settings.currency);
  const [quickOpen, setQuickOpen] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const storeIndex = useMemo(() => {
    const list: { product: Product; haystack: string; skuLower: string }[] = [];
    for (const p of products) {
      if (p.storeId !== storeId || p.stock <= 0) continue;
      list.push({
        product: p,
        haystack: `${p.name} ${p.sku} ${p.category ?? ""}`.toLowerCase(),
        skuLower: p.sku.toLowerCase(),
      });
    }
    return list;
  }, [products, storeId]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    if (!q) return storeIndex.slice(0, 24).map((e) => e.product);
    const exactSku = storeIndex.find((e) => e.skuLower === q);
    if (exactSku) return [exactSku.product];
    const out: Product[] = [];
    for (const e of storeIndex) {
      if (e.haystack.includes(q)) {
        out.push(e.product);
        if (out.length >= 24) break;
      }
    }
    return out;
  }, [storeIndex, debouncedSearch]);

  const allCategories = useMemo(() => {
    const s = new Set<string>();
    products.forEach((p) => p.category && s.add(p.category));
    return Array.from(s).sort();
  }, [products]);

  const addToCart = (p: Product) => {
    setCart((c) => {
      const existing = c.find((i) => i.productId === p.id);
      if (existing) {
        if (existing.quantity >= p.stock) { toast.error("Stock insuffisant"); return c; }
        return c.map((i) => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...c, { productId: p.id, name: p.name, price: p.price, quantity: 1 }];
    });
  };

  const updateQty = (id: string, delta: number) => {
    setCart((c) =>
      c.flatMap((i) => {
        if (i.productId !== id) return [i];
        const product = products.find((p) => p.id === id);
        const newQ = i.quantity + delta;
        if (newQ <= 0) return [];
        if (product && newQ > product.stock) { toast.error("Stock insuffisant"); return [i]; }
        return [{ ...i, quantity: newQ }];
      })
    );
  };

  // Calculs
  const subtotal = +cart.reduce((a, i) => a + i.price * i.quantity, 0).toFixed(2);

  // Plafond remise selon rôle
  const maxDiscount = isAdmin ? 100 : settings.maxDiscountPercent;
  const safeDiscount = Math.max(0, Math.min(maxDiscount, discount));

  const discountAmt = +(subtotal * (safeDiscount / 100)).toFixed(2);

  // Points utilisés
  const maxRedeemable = customer ? customer.points : 0;
  const usedPoints = Math.max(0, Math.min(maxRedeemable, redeemPoints));
  const pointsValue = +(usedPoints * settings.euroPerPoint).toFixed(2);

  const taxableBase = Math.max(0, subtotal - discountAmt - pointsValue);
  const tax = +(taxableBase * (settings.taxRate / 100)).toFixed(2);
  const total = +(taxableBase + tax).toFixed(2);
  const change = paymentMode === "CASH" && amountPaid > 0 ? +(amountPaid - total).toFixed(2) : 0;

  const checkout = () => {
    if (!user) { toast.error("Session expirée"); return; }
    if (cart.length === 0) return;
    if (paymentMode === "CASH") {
      if (amountPaid <= 0) { toast.error("Saisissez le montant reçu"); return; }
      if (amountPaid < total) { toast.error("Montant reçu insuffisant"); return; }
    }
    const pointsEarned = customer ? Math.floor(total * settings.pointsPerEuro) : 0;
    const sale = addSale({
      storeId,
      userId: user.id,
      userName: user.name,
      items: cart,
      subtotal,
      tax,
      taxRate: settings.taxRate,
      discount: discountAmt,
      total,
      customerId: customer?.id,
      customerName: customer?.name || customer?.phone,
      pointsEarned,
      pointsRedeemed: usedPoints,
      paymentMode,
      amountPaid: paymentMode === "CASH" ? amountPaid : total,
      change,
      currency: saleCurrency,
    });
    if (customer) applyPurchase(customer.id, total, pointsEarned, usedPoints);
    setReceipt(sale);
    setCart([]);
    setDiscount(0);
    setCustomer(null);
    setRedeemPoints(0);
    setPaymentMode("CASH");
    setAmountPaid(0);
    toast.success("Vente validée");
  };

  // Raccourcis clavier
  useHotkeys({
    f2: (e) => { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); },
    f9: (e) => { e.preventDefault(); checkout(); },
    escape: () => { setSearch(""); },
  });

  // Si SKU exact + Enter dans le champ recherche → ajout direct
  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const q = search.trim().toLowerCase();
      if (!q) return;
      const exact = storeIndex.find((p) => p.skuLower === q);
      if (exact) {
        addToCart(exact.product);
        setSearch("");
      } else if (filtered.length === 1) {
        addToCart(filtered[0]);
        setSearch("");
      }
    }
  };

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-1 gap-4 md:grid-cols-[1fr_380px]">
      {/* Products grid */}
      <div className="flex flex-col space-y-4 overflow-hidden">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <ScanLine className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Rechercher / scanner code-barres ou SKU... (F2)"
              className="h-11 pl-9 text-base"
              autoFocus
            />
          </div>
          {isAdmin && (
            <Select value={activeStore} onValueChange={setActiveStore}>
              <SelectTrigger className="sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          {isAdmin && (
            <Button variant="outline" onClick={() => setQuickOpen(true)} title="Nouveau produit rapide">
              <Plus className="mr-1 h-4 w-4" /> Produit
            </Button>
          )}
          <Button variant="outline" onClick={() => {
            if (cart.length === 0) { toast.error("Panier vide"); return; }
            parkCart({ storeId, userId: user!.id, items: cart, customerId: customer?.id, customerName: customer?.name, label: `${cart.length} art.` });
            setCart([]); setCustomer(null);
            toast.success("Panier mis en attente");
          }} title="Mettre en attente">
            <Pause className="mr-1 h-4 w-4" /> Park
          </Button>
          {parked.length > 0 && (
            <Select onValueChange={(id) => {
              const c = unparkCart(id);
              if (c) { setCart(c.items); toast.success("Panier repris"); }
            }}>
              <SelectTrigger className="w-32"><Play className="mr-1 h-3 w-3" /><SelectValue placeholder={`${parked.length} en attente`} /></SelectTrigger>
              <SelectContent>{parked.map((p) => <SelectItem key={p.id} value={p.id}>{p.label} — {new Date(p.createdAt).toLocaleTimeString("fr-FR")}</SelectItem>)}</SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" onClick={() => setShowHotkeys(true)} title="Raccourcis">
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <button
              key={p.id}
              onClick={() => addToCart(p)}
              className="gradient-card group flex flex-col rounded-xl border border-border p-3 text-left transition hover:-translate-y-0.5 hover:border-primary hover:shadow-glow"
            >
              <div className="mb-2 flex aspect-square items-center justify-center rounded-lg bg-secondary text-3xl">
                {emojiFor(p.category)}
              </div>
              <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{p.sku}</p>
              <div className="mt-2 flex items-center justify-between">
                <span className="font-mono text-base font-bold text-primary">{fmt(p.price)}</span>
                <Badge variant="outline" className="text-[10px]">×{p.stock}</Badge>
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-muted-foreground">Aucun produit disponible.</p>
          )}
        </div>
      </div>

      {/* Cart */}
      <Card className="gradient-card flex flex-col border-border p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Panier</h2>
          <Badge variant="secondary">{cart.reduce((a, i) => a + i.quantity, 0)} articles</Badge>
        </div>

        <div className="mb-3">
          <CustomerPicker value={customer} onChange={(c) => { setCustomer(c); setRedeemPoints(0); }} />
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto pr-1">
          {cart.length === 0 && (
            <p className="py-12 text-center text-sm text-muted-foreground">Sélectionnez des produits…</p>
          )}
          {cart.map((i) => (
            <div key={i.productId} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{fmt(i.price)} / pc</p>
                </div>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCart((c) => c.filter((x) => x.productId !== i.productId))}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.productId, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="w-8 text-center font-mono">{i.quantity}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7" onClick={() => updateQty(i.productId, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                <span className="font-mono font-semibold">{fmt(i.quantity * i.price)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Sous-total</span>
            <span className="font-mono">{fmt(subtotal)}</span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="text-muted-foreground" htmlFor="discount">
              Remise % {!isAdmin && <span className="text-[10px]">(max {settings.maxDiscountPercent}%)</span>}
            </label>
            <Input
              id="discount" type="number" min={0} max={maxDiscount}
              value={discount}
              onChange={(e) => {
                const v = +e.target.value || 0;
                if (!isAdmin && v > settings.maxDiscountPercent) {
                  toast.error(`Remise plafonnée à ${settings.maxDiscountPercent}%`);
                }
                setDiscount(Math.max(0, Math.min(maxDiscount, v)));
              }}
              className="h-7 w-20 text-right font-mono"
            />
          </div>

          {customer && customer.points > 0 && (
            <div className="flex items-center justify-between rounded bg-warning/10 px-2 py-1.5 text-sm">
              <label className="flex items-center gap-1 text-warning" htmlFor="points">
                <Star className="h-3 w-3" /> Utiliser pts (max {customer.points})
              </label>
              <Input
                id="points" type="number" min={0} max={maxRedeemable}
                value={redeemPoints}
                onChange={(e) => setRedeemPoints(Math.max(0, Math.min(maxRedeemable, +e.target.value || 0)))}
                className="h-7 w-20 text-right font-mono"
              />
            </div>
          )}
          {usedPoints > 0 && (
            <div className="flex items-center justify-between text-xs text-warning">
              <span>− Réduction fidélité</span>
              <span className="font-mono">−{fmt(pointsValue)}</span>
            </div>
          )}

          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">TVA ({settings.taxRate}%)</span>
            <span className="font-mono">{fmt(tax)}</span>
          </div>

          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Paiement</span>
            <Select value={paymentMode} onValueChange={(v: PaymentMode) => setPaymentMode(v)}>
              <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="CASH">Espèces</SelectItem>
                <SelectItem value="CARD">Carte</SelectItem>
                <SelectItem value="MIXED">Mixte</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Devise affichée</span>
            <Select value={saleCurrency} onValueChange={(v: "AR" | "EUR") => setSaleCurrency(v)}>
              <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="AR">Ariary (Ar)</SelectItem>
                <SelectItem value="EUR">Euro (€)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {paymentMode === "CASH" && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Reçu</span>
                <Input
                  type="number" step="0.01" min={0} value={amountPaid || ""}
                  onChange={(e) => setAmountPaid(+e.target.value || 0)}
                  placeholder="0.00"
                  className="h-7 w-24 text-right font-mono"
                />
              </div>
              {change > 0 && (
                <div className="flex items-center justify-between text-sm font-semibold text-success">
                  <span>Rendu monnaie</span>
                  <span className="font-mono">{fmt(change)}</span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-2">
            <span className="font-display text-lg font-bold">Total</span>
            <span className="font-mono text-2xl font-bold text-primary">{fmt(total)}</span>
          </div>
          <Button
            className="h-12 w-full gradient-primary text-base text-primary-foreground hover:opacity-90"
            disabled={cart.length === 0}
            onClick={checkout}
          >
            <Banknote className="mr-2 h-5 w-5" /> Encaisser <span className="ml-2 text-xs opacity-70">(F9)</span>
          </Button>
        </div>
      </Card>

      {/* Quick add product */}
      {isAdmin && (
        <QuickProductDialog
          open={quickOpen}
          onOpenChange={setQuickOpen}
          storeId={storeId}
          categories={allCategories}
          onCreate={(form) => {
            const res = addProduct({ ...form, storeId });
            if (!res.ok) { toast.error(res.error ?? "Erreur"); return false; }
            toast.success("Produit ajouté");
            return true;
          }}
        />
      )}

      {/* Hotkeys help */}
      <Dialog open={showHotkeys} onOpenChange={setShowHotkeys}>
        <DialogContent>
          <DialogHeader><DialogTitle>Raccourcis clavier</DialogTitle></DialogHeader>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Focus recherche</span><kbd className="rounded bg-secondary px-2 py-0.5 font-mono">F2</kbd></div>
            <div className="flex justify-between"><span>Encaisser</span><kbd className="rounded bg-secondary px-2 py-0.5 font-mono">F9</kbd></div>
            <div className="flex justify-between"><span>Vider la recherche</span><kbd className="rounded bg-secondary px-2 py-0.5 font-mono">Échap</kbd></div>
            <div className="flex justify-between"><span>Ajouter SKU exact au panier</span><kbd className="rounded bg-secondary px-2 py-0.5 font-mono">Entrée</kbd></div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Receipt */}
      <Dialog open={!!receipt} onOpenChange={(v) => !v && setReceipt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ReceiptIcon className="h-5 w-5 text-primary" /> Reçu de vente
            </DialogTitle>
          </DialogHeader>
          {receipt && (
            <div className="print-receipt font-mono text-sm">
              <div className="mb-3 text-center">
                <p className="font-display text-lg font-bold">{settings.shopName}</p>
                <p className="text-xs text-muted-foreground">{stores.find((s) => s.id === receipt.storeId)?.name}</p>
                <p className="text-xs text-muted-foreground">{new Date(receipt.date).toLocaleString("fr-FR")}</p>
                <p className="text-xs text-muted-foreground">Caissier: {receipt.userName}</p>
                {receipt.customerName && <p className="text-xs text-muted-foreground">Client: {receipt.customerName}</p>}
                <p className="text-xs text-muted-foreground">Ticket #{receipt.id.slice(-6)}</p>
              </div>
              <div className="border-y border-dashed border-border py-2">
                {receipt.items.map((i) => (
                  <div key={i.productId} className="flex justify-between text-xs">
                    <span>{i.quantity}× {i.name}</span>
                    <span>{fmt(i.price * i.quantity, receipt.currency)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 py-2 text-xs">
                <div className="flex justify-between"><span>Sous-total</span><span>{fmt(receipt.subtotal, receipt.currency)}</span></div>
                {receipt.discount > 0 && <div className="flex justify-between"><span>Remise</span><span>-{fmt(receipt.discount, receipt.currency)}</span></div>}
                {receipt.pointsRedeemed > 0 && <div className="flex justify-between text-warning"><span>Points utilisés ({receipt.pointsRedeemed})</span><span>-{fmt(receipt.pointsRedeemed * settings.euroPerPoint, receipt.currency)}</span></div>}
                <div className="flex justify-between"><span>TVA ({receipt.taxRate}%)</span><span>{fmt(receipt.tax, receipt.currency)}</span></div>
                <div className="flex justify-between border-t border-dashed border-border pt-1 font-bold text-base text-primary"><span>TOTAL</span><span>{fmt(receipt.total, receipt.currency)}</span></div>
                <div className="flex justify-between"><span>Paiement</span><span>{receipt.paymentMode === "CASH" ? "Espèces" : receipt.paymentMode === "CARD" ? "Carte" : "Mixte"}</span></div>
                {receipt.paymentMode === "CASH" && receipt.change != null && receipt.change > 0 && (
                  <div className="flex justify-between"><span>Rendu</span><span>{fmt(receipt.change, receipt.currency)}</span></div>
                )}
                {receipt.pointsEarned > 0 && (
                  <div className="flex justify-between text-warning"><span>Points gagnés</span><span>+{receipt.pointsEarned}</span></div>
                )}
              </div>
              <p className="mt-2 text-center text-xs text-muted-foreground">Merci de votre visite ❤️</p>
              <div className="mt-4 flex gap-2 no-print">
                <Button variant="outline" className="flex-1" onClick={() => window.print()}>
                  <Printer className="mr-2 h-4 w-4" /> Imprimer
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => downloadReceiptPdf(receipt, stores.find((s) => s.id === receipt.storeId), settings)}>
                  <FileText className="mr-2 h-4 w-4" /> PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function QuickProductDialog({
  open, onOpenChange, storeId, categories, onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storeId: string;
  categories: string[];
  onCreate: (form: { name: string; sku: string; price: number; stock: number; category?: string }) => boolean;
}) {
  const [form, setForm] = useState({ name: "", sku: "", price: 0, stock: 1, category: undefined as string | undefined });

  const submit = (keepOpen: boolean) => {
    if (!form.name.trim() || form.price <= 0) {
      toast.error("Nom et prix requis");
      return;
    }
    const sku = form.sku.trim() || `KZ-${storeId.toUpperCase()}-${Date.now().toString().slice(-5)}`;
    const ok = onCreate({ ...form, sku, name: form.name.trim() });
    if (ok) {
      setForm({ name: "", sku: "", price: 0, stock: 1, category: form.category });
      if (!keepOpen) onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nouveau produit rapide</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Nom *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label>Référence (SKU)</Label>
            <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} placeholder="auto" />
          </div>
          <div className="space-y-1.5">
            <Label>Prix (€ HT) *</Label>
            <Input type="number" step="0.01" value={form.price || ""} onChange={(e) => setForm({ ...form, price: +e.target.value || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Stock</Label>
            <Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: +e.target.value || 0 })} />
          </div>
          <div className="space-y-1.5">
            <Label>Catégorie</Label>
            <CategoryCombobox value={form.category} onChange={(v) => setForm({ ...form, category: v })} options={categories} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => submit(true)}>Ajouter & continuer</Button>
          <Button className="gradient-primary text-primary-foreground" onClick={() => submit(false)}>Ajouter</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emojiFor(cat?: string) {
  switch (cat) {
    case "Jouets": return "🧸";
    case "Vêtements": return "👕";
    case "Accessoires": return "🎒";
    case "Peluches": return "🐻";
    case "Jeux éducatifs": return "🧩";
    default: return "🎁";
  }
}
