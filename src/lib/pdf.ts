import jsPDF from "jspdf";
import type { Sale, Store } from "@/store/data";
import type { Settings } from "@/store/settings";

export function downloadReceiptPdf(sale: Sale, store: Store | undefined, settings: Settings) {
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
    line(`${it.quantity}x ${it.name.slice(0, 28)}`, `${(it.price * it.quantity).toFixed(2)} €`);
  }
  sep();
  line("Sous-total", `${sale.subtotal.toFixed(2)} €`);
  if (sale.discount > 0) line("Remise", `-${sale.discount.toFixed(2)} €`);
  if (sale.pointsRedeemed > 0) line(`Points (-${sale.pointsRedeemed})`, `-${(sale.pointsRedeemed * settings.euroPerPoint).toFixed(2)} €`);
  line(`TVA (${sale.taxRate}%)`, `${sale.tax.toFixed(2)} €`);
  line("TOTAL", `${sale.total.toFixed(2)} €`, 10, true);
  line("Paiement", sale.paymentMode === "CASH" ? "Espèces" : sale.paymentMode === "CARD" ? "Carte" : "Mixte");
  if (sale.paymentMode === "CASH" && sale.change != null && sale.change > 0) {
    line("Rendu", `${sale.change.toFixed(2)} €`);
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
  doc.text(`Total : ${total.toFixed(2)} €`, 14, 40);
  doc.text(`Dont TVA : ${tax.toFixed(2)} €`, 14, 47);
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
    doc.text(`${s.total.toFixed(2)} €`, 195, y, { align: "right" });
    y += 5;
  }

  doc.save(`rapport-ventes-${new Date().toISOString().slice(0, 10)}.pdf`);
}
