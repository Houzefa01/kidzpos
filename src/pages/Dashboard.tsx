import { useAuth } from "@/store/auth";
import { useData } from "@/store/data";
import { useSettings } from "@/store/settings";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Banknote, AlertTriangle, Package, TrendingUp, TrendingDown, Star } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMemo } from "react";
import { useFormatMoney } from "@/lib/money";

export default function Dashboard() {
  const { user } = useAuth();
  const { products, sales, stores } = useData();
  const { settings } = useSettings();
  const fmt = useFormatMoney();

  const isAdmin = user?.role === "ADMIN";
  const scopedSales = useMemo(() => isAdmin ? sales : sales.filter((s) => s.storeId === user?.storeId), [sales, isAdmin, user]);
  const scopedProducts = useMemo(() => isAdmin ? products : products.filter((p) => p.storeId === user?.storeId), [products, isAdmin, user]);

  const revenue = useMemo(() => scopedSales.reduce((acc, s) => acc + s.total, 0), [scopedSales]);
  const lowStock = useMemo(() => scopedProducts.filter((p) => p.stock <= 3).length, [scopedProducts]);

  const byStore = useMemo(() => stores.map((st) => ({
    name: st.name.split("—")[0].trim(),
    Ventes: sales.filter((s) => s.storeId === st.id).reduce((a, s) => a + s.total, 0),
  })), [stores, sales]);

  const days = useMemo(() => {
    const result: { day: string; Total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const total = scopedSales.filter((s) => s.date.slice(0, 10) === key).reduce((a, s) => a + s.total, 0);
      result.push({ day: d.toLocaleDateString("fr-FR", { weekday: "short" }), Total: +total.toFixed(2) });
    }
    return result;
  }, [scopedSales]);

  // Stats mensuelles : 12 derniers mois + comparaison mois en cours vs précédent
  const months = useMemo(() => {
    const out: { label: string; key: string; Total: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const total = scopedSales
        .filter((s) => s.date.slice(0, 7) === key)
        .reduce((a, s) => a + s.total, 0);
      out.push({ label: d.toLocaleDateString("fr-FR", { month: "short" }), key, Total: +total.toFixed(2) });
    }
    return out;
  }, [scopedSales]);

  const currentMonth = months[months.length - 1]?.Total ?? 0;
  const prevMonth = months[months.length - 2]?.Total ?? 0;
  const monthDelta = prevMonth > 0 ? ((currentMonth - prevMonth) / prevMonth) * 100 : currentMonth > 0 ? 100 : 0;

  // Top 5 produits (par CA)
  const topProducts = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const s of scopedSales) {
      if (s.refundedFrom) continue;
      for (const it of s.items) {
        const cur = map.get(it.productId) ?? { name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += it.price * it.quantity;
        map.set(it.productId, cur);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [scopedSales]);

  const recent = [...scopedSales].slice(0, 6);

  // Helper recharts Tooltip : signature alignée sur `Formatter` de recharts
  // (ValueType = number | string | ReadonlyArray<number|string>, peut être undefined).
  const tooltipFmt = (value: number | string | ReadonlyArray<number | string> | undefined): string => {
    if (value == null) return "";
    const v = Array.isArray(value) ? value[0] : (value as number | string);
    if (v == null) return "";
    return fmt(typeof v === "number" ? v : Number(v));
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Bonjour, {user?.name.split(" ")[0]} 👋</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? `Vue consolidée — ${settings.shopName}.` : "Aperçu de votre magasin."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Chiffre d'affaires" value={fmt(revenue)} hint={`${scopedSales.length} ventes`} icon={Banknote} tone="primary" />
        <StatCard label="Mois en cours" value={fmt(currentMonth)} hint={`${monthDelta >= 0 ? "+" : ""}${monthDelta.toFixed(1)}% vs précédent`} icon={monthDelta >= 0 ? TrendingUp : TrendingDown} tone={monthDelta >= 0 ? "success" : "warning"} />
        <StatCard label="Produits actifs" value={String(scopedProducts.length)} hint={isAdmin ? "tous magasins" : "votre stock"} icon={Package} tone="accent" />
        <StatCard label="Stock faible" value={String(lowStock)} hint="≤ 3 unités" icon={AlertTriangle} tone="warning" />
      </div>

      <Tabs defaultValue="week" className="space-y-4">
        <TabsList>
          <TabsTrigger value="week">7 jours</TabsTrigger>
          <TabsTrigger value="month">12 mois</TabsTrigger>
          <TabsTrigger value="top">Top produits</TabsTrigger>
        </TabsList>

        <TabsContent value="week">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="gradient-card border-border p-5 lg:col-span-2">
              <h3 className="mb-4 font-display text-lg font-semibold">Ventes — 7 derniers jours</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={days}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                    <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={tooltipFmt} />
                    <Line type="monotone" dataKey="Total" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ fill: "hsl(var(--primary))" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            {isAdmin && (
              <Card className="gradient-card border-border p-5">
                <h3 className="mb-4 font-display text-lg font-semibold">Par magasin</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={byStore}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                      <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={tooltipFmt} />
                      <Bar dataKey="Ventes" radius={[8, 8, 0, 0]}>
                        {byStore.map((_, i) => <Cell key={i} fill={i === 0 ? "hsl(var(--primary))" : "hsl(var(--accent))"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="month">
          <Card className="gradient-card border-border p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">Chiffre d'affaires — 12 derniers mois</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={months}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <Tooltip contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} formatter={tooltipFmt} />
                  <Bar dataKey="Total" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="top">
          <Card className="gradient-card border-border p-5">
            <h3 className="mb-4 font-display text-lg font-semibold">Top 5 produits (CA)</h3>
            {topProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune donnée.</p>
            ) : (
              <div className="space-y-3">
                {topProducts.map((p, i) => {
                  const max = topProducts[0].revenue;
                  const pct = (p.revenue / max) * 100;
                  return (
                    <div key={p.name} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="flex items-center gap-2">
                          <Badge variant="outline" className="font-mono">#{i + 1}</Badge>
                          {i === 0 && <Star className="h-3.5 w-3.5 text-warning" />}
                          {p.name}
                        </span>
                        <span className="font-mono font-semibold">{fmt(p.revenue)} · {p.qty}u</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full gradient-primary" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="gradient-card border-border p-5">
        <h3 className="mb-4 font-display text-lg font-semibold">Activité récente</h3>
        <div className="divide-y divide-border">
          {recent.length === 0 && <p className="text-sm text-muted-foreground">Aucune vente pour le moment.</p>}
          {recent.map((s) => {
            const store = stores.find((x) => x.id === s.storeId);
            return (
              <div key={s.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium">
                    {s.refundedFrom ? "↩️ Remboursement " : "Vente "}#{String(s.seq).padStart(6, "0")} — {s.userName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {store?.name} · {new Date(s.date).toLocaleString("fr-FR")}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="secondary">{s.items.reduce((a, i) => a + i.quantity, 0)} art.</Badge>
                  <span className={`font-mono font-semibold ${s.total < 0 ? "text-destructive" : "text-primary"}`}>{fmt(s.total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
