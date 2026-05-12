import { useMemo, useState } from "react";
import { useAuth } from "@/store/auth";
import { useData, paymentLabel } from "@/store/data";
import { useSettings } from "@/store/settings";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Download, Search, FileText, Undo2, Eye, Printer } from "lucide-react";
import { toast } from "sonner";
import { downloadReceiptPdf, downloadSalesReportPdf } from "@/lib/pdf";
import { useFormatMoney } from "@/lib/money";

export default function Sales() {
  const { user } = useAuth();
  const fmt = useFormatMoney();
  const { sales, stores, refundSale } = useData();
  const { settings } = useSettings();
  const isAdmin = user?.role === "ADMIN";

  const [search, setSearch] = useState("");
  const [storeFilter, setStoreFilter] = useState<string>(isAdmin ? "all" : (user?.storeId ?? "all"));
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [viewSale, setViewSale] = useState<typeof sales[number] | null>(null);

  const filtered = useMemo(() => {
    // Comparaison correcte : convertir en timestamps numériques
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59.999").getTime() : null;
    return sales.filter((s) => {
      if (!isAdmin && s.storeId !== user?.storeId) return false;
      if (storeFilter !== "all" && s.storeId !== storeFilter) return false;
      if (fromTs !== null) {
        const saleTs = new Date(s.date).getTime();
        if (saleTs < fromTs) return false;
      }
      if (toTs !== null) {
        const saleTs = new Date(s.date).getTime();
        if (saleTs > toTs) return false;
      }
      if (search && !`${s.id} ${s.seq} ${s.userName} ${s.customerName ?? ""} ${s.items.map((i) => i.name).join(" ")}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [sales, search, storeFilter, isAdmin, user, from, to]);

  const total = filtered.reduce((a, s) => a + s.total, 0);

  const exportCSV = () => {
    const rows = [
      ["Ticket", "Date", "Magasin", "Caissier", "Client", "Articles", "Sous-total", "Remise", "TVA", "Total", "Type"],
      ...filtered.map((s) => [
        String(s.seq).padStart(6, "0"),
        new Date(s.date).toLocaleString("fr-FR"),
        stores.find((x) => x.id === s.storeId)?.name ?? "",
        s.userName,
        s.customerName ?? "",
        String(s.items.reduce((a, i) => a + i.quantity, 0)),
        s.subtotal.toFixed(2), s.discount.toFixed(2), s.tax.toFixed(2), s.total.toFixed(2),
        s.refundedFrom ? "Remboursement" : "Vente",
      ]),
    ];
    // Échappement CSV standard : doubler les guillemets internes
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `ventes-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Export CSV téléchargé");
  };

  const exportPDF = () => {
    const label = `Filtre : ${storeFilter === "all" ? "tous magasins" : stores.find((s) => s.id === storeFilter)?.name ?? ""}${from ? ` · du ${from}` : ""}${to ? ` au ${to}` : ""}`;
    downloadSalesReportPdf(filtered, stores, settings.shopName, label);
    toast.success("PDF téléchargé");
  };

  const onRefund = (id: string) => {
    if (!user) return;
    const res = refundSale(id, { userId: user.id, userName: user.name });
    if (!res.ok) toast.error(res.error ?? "Erreur");
    else toast.success("Vente remboursée");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold">Historique des ventes</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.length} vente(s) · <span className="font-mono text-primary">{fmt(total)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCSV}><Download className="mr-2 h-4 w-4" /> CSV</Button>
          <Button variant="outline" onClick={exportPDF}><FileText className="mr-2 h-4 w-4" /> PDF</Button>
        </div>
      </div>

      <Card className="gradient-card border-border p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher (ticket, client, produit, caissier)..." className="pl-9" />
          </div>
          {isAdmin && (
            <Select value={storeFilter} onValueChange={setStoreFilter}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les magasins</SelectItem>
                {stores.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <div className="flex gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="text-xs" />
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="text-xs" />
          </div>
        </div>
      </Card>

      <Card className="gradient-card border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Magasin</TableHead>
              <TableHead>Caissier</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Articles</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((s) => {
              const isRefund = !!s.refundedFrom;
              const alreadyRefunded = sales.some((x) => x.refundedFrom === s.id);
              return (
                <TableRow key={s.id} className={isRefund ? "bg-destructive/5" : ""}>
                  <TableCell className="font-mono text-xs">
                    #{String(s.seq).padStart(6, "0")} {isRefund && <Badge variant="destructive" className="ml-1 text-[9px]">RBT</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">{new Date(s.date).toLocaleString("fr-FR")}</TableCell>
                  <TableCell className="text-xs">{stores.find((x) => x.id === s.storeId)?.name.split("—")[0]}</TableCell>
                  <TableCell className="text-xs">{s.userName}</TableCell>
                  <TableCell className="text-xs">{s.customerName || <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell><Badge variant="secondary">{s.items.reduce((a, i) => a + i.quantity, 0)}</Badge></TableCell>
                  <TableCell className={`text-right font-mono font-semibold ${s.total < 0 ? "text-destructive" : "text-primary"}`}>{fmt(s.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setViewSale(s)} title="Voir"><Eye className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => downloadReceiptPdf(s, stores.find((x) => x.id === s.storeId), settings)} title="PDF"><FileText className="h-4 w-4" /></Button>
                      {!isRefund && !alreadyRefunded && (
                        <ConfirmDialog
                          trigger={<Button size="icon" variant="ghost" title="Rembourser"><Undo2 className="h-4 w-4 text-warning" /></Button>}
                          title={`Rembourser la vente #${String(s.seq).padStart(6, "0")} ?`}
                          description="Le stock sera réintégré et un ticket d'avoir sera émis."
                          destructive
                          onConfirm={() => onRefund(s.id)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">Aucune vente.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewSale} onOpenChange={(v) => !v && setViewSale(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Ticket #{viewSale && String(viewSale.seq).padStart(6, "0")}</DialogTitle></DialogHeader>
          {viewSale && (
            <div className="print-receipt font-mono text-sm">
              <div className="text-center">
                <p className="font-bold">{settings.shopName}</p>
                <p className="text-xs">{stores.find((s) => s.id === viewSale.storeId)?.name}</p>
                <p className="text-xs">{new Date(viewSale.date).toLocaleString("fr-FR")}</p>
                <p className="text-xs">Caissier : {viewSale.userName}</p>
                {viewSale.customerName && <p className="text-xs">Client : {viewSale.customerName}</p>}
              </div>
              <hr className="my-2 border-dashed" />
              {viewSale.items.map((i) => (
                <div key={i.productId} className="flex justify-between text-xs">
                  <span>{i.quantity}× {i.name}</span><span>{fmt(i.price * i.quantity, viewSale.currency)}</span>
                </div>
              ))}
              <hr className="my-2 border-dashed" />
              <div className="flex justify-between text-xs"><span>Sous-total</span><span>{fmt(viewSale.subtotal, viewSale.currency)}</span></div>
              {viewSale.discount !== 0 && <div className="flex justify-between text-xs"><span>Remise</span><span>-{fmt(viewSale.discount, viewSale.currency)}</span></div>}
              {viewSale.pointsRedeemed > 0 && (
                <div className="flex justify-between text-xs text-warning">
                  <span>Points utilisés ({viewSale.pointsRedeemed})</span>
                  <span>-{fmt(viewSale.pointsRedeemed * settings.arPerPoint, viewSale.currency)}</span>
                </div>
              )}
              <div className="flex justify-between text-xs"><span>TVA ({viewSale.taxRate}%)</span><span>{fmt(viewSale.tax, viewSale.currency)}</span></div>
              <div className="flex justify-between text-base font-bold"><span>TOTAL</span><span>{fmt(viewSale.total, viewSale.currency)}</span></div>
              <div className="flex justify-between text-xs">
                <span>Paiement</span>
                <span>{paymentLabel(viewSale.paymentMode)}</span>
              </div>
              {viewSale.paymentMode === "CASH" && viewSale.change != null && viewSale.change > 0 && (
                <div className="flex justify-between text-xs"><span>Rendu</span><span>{fmt(viewSale.change, viewSale.currency)}</span></div>
              )}
              {viewSale.pointsEarned > 0 && (
                <div className="flex justify-between text-xs text-warning">
                  <span>Points gagnés</span><span>+{viewSale.pointsEarned}</span>
                </div>
              )}
              <div className="mt-3 flex gap-2 no-print">
                <Button variant="outline" className="flex-1" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" /> Imprimer</Button>
                <Button variant="outline" className="flex-1" onClick={() => downloadReceiptPdf(viewSale, stores.find((x) => x.id === viewSale.storeId), settings)}><FileText className="mr-2 h-4 w-4" /> PDF</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
