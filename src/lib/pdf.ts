import jsPDF from "jspdf";
import type { Sale, Store } from "@/store/data";
import { paymentLabel } from "@/store/data";
import type { Settings } from "@/store/settings";
import { formatMoneyAs } from "@/lib/money";
import { useExchange } from "@/store/exchange";
import { useSettings } from "@/store/settings";

export function downloadReceiptPdf(sale: Sale, store: Store | undefined, settings: Settings) {
  // Reçu individuel : on respecte la devise FIGÉE de la vente (sale.currency).
  // Pas la devise globale courante — un client doit voir son ticket dans la
  // devise dans laquelle il a payé.
  const rate = useExchange.getState().rate;
  const m = (eur: number) => formatMoneyAs(eur, sale.currency, rate);

  // Format ticket 80mm de large (~ thermal)
  const doc = new jsPDF({ unit: "mm", format: [80, 200] });
  let y = 8;
  const center = (text: string, size = 9, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.text(text, 40, y, { align: "center" });
    y += size * 0.4 + 1;
  };
  const line = (left: string, right?: string, size = 8, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    doc.text(left, 4, y);
    if (right) doc.text(right, 76, y, { align: "right" });
    y += size * 0.4 + 1;
  };
  const sep = () => { doc.setLineDashPattern([1, 1], 0); doc.line(4, y, 76, y); y += 2; };

  center(settings.shopName, 12, true);
  if (store) center(store.name, 8);
  center(new Date(sale.date).toLocaleString("fr-FR"), 7);
  center(`Ticket #${sale.seq ? String(sale.seq).padStart(6, "0") : sale.id.slice(-6)}`, 8, true);
  center(`Caissier : ${sale.userName}`, 7);
  if (sale.customerName) center(`Client : ${sale.customerName}`, 7);
  sep();
  for (const it of sale.items) {
    line(`${it.quantity}x ${it.name.slice(0, 28)}`, m(it.price * it.quantity));
  }
  sep();
  line("Sous-total", m(sale.subtotal));
  if (sale.discount > 0) line("Remise", `-${m(sale.discount)}`);
  if (sale.pointsRedeemed > 0) line(`Points (-${sale.pointsRedeemed})`, `-${m(sale.pointsRedeemed * settings.arPerPoint)}`);
  line(`TVA (${sale.taxRate}%)`, m(sale.tax));
  line("TOTAL", m(sale.total), 10, true);
  line("Paiement", paymentLabel(sale.paymentMode));
  if (sale.paymentMode === "CASH" && sale.amountPaid != null) {
    line("Reçu", m(sale.amountPaid));
  }
  if (sale.paymentMode === "CASH" && sale.change != null && sale.change > 0) {
    line("Rendu", m(sale.change));
  }
  if (sale.pointsEarned > 0) line("Points gagnés", `+${sale.pointsEarned}`);
  sep();
  center("Merci de votre visite !", 8);

  doc.save(`recu-${sale.seq ?? sale.id.slice(-6)}.pdf`);
}

export function downloadSalesReportPdf(
  sales: Sale[],
  stores: Store[],
  shopName: string,
  filterLabel: string,
) {
  // Rapport agrégé : on utilise la devise GLOBALE courante (settings.currency),
  // pas celle de chaque vente — un mélange n'aurait pas de sens dans des totaux.
  const rate = useExchange.getState().rate;
  const currency = useSettings.getState().settings.currency;
  const m = (eur: number) => formatMoneyAs(eur, currency, rate);

  const doc = new jsPDF();
  doc.setFont("helvetica", "bold").setFontSize(16);
  doc.text(`${shopName} — Rapport des ventes`, 14, 18);
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text(filterLabel, 14, 25);
  doc.text(`Édité le ${new Date().toLocaleString("fr-FR")}`, 14, 30);

  // Stats
  const total = sales.reduce((a, s) => a + s.total, 0);
  const tax = sales.reduce((a, s) => a + s.tax, 0);
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text(`Total : ${m(total)}`, 14, 40);
  doc.text(`Dont TVA : ${m(tax)}`, 14, 47);
  doc.text(`Nombre de tickets : ${sales.length}`, 14, 54);

  // Table headers
  let y = 65;
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Ticket", 14, y);
  doc.text("Date", 35, y);
  doc.text("Magasin", 70, y);
  doc.text("Caissier", 110, y);
  doc.text("Articles", 145, y);
  doc.text("Total", 195, y, { align: "right" });
  y += 2;
  doc.line(14, y, 196, y);
  y += 4;
  doc.setFont("helvetica", "normal").setFontSize(8);

  for (const s of sales) {
    if (y > 280) { doc.addPage(); y = 20; }
    doc.text(`#${s.seq ? String(s.seq).padStart(6, "0") : s.id.slice(-6)}`, 14, y);
    doc.text(new Date(s.date).toLocaleDateString("fr-FR"), 35, y);
    doc.text((stores.find((x) => x.id === s.storeId)?.name ?? "").slice(0, 18), 70, y);
    doc.text(s.userName.slice(0, 14), 110, y);
    doc.text(String(s.items.reduce((a, i) => a + i.quantity, 0)), 145, y);
    doc.text(m(s.total), 195, y, { align: "right" });
    y += 5;
  }

  doc.save(`rapport-ventes-${new Date().toISOString().slice(0, 10)}.pdf`);
}
