import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type Sheet = { name: string; head: string[]; rows: (string | number)[][] };

export function downloadExcel(file: string, sheets: Sheet[]) {
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.aoa_to_sheet([s.head, ...s.rows]);
    ws["!cols"] = s.head.map((h, i) => ({ wch: Math.min(40, Math.max(h.length, ...s.rows.map((r) => String(r[i] ?? "").length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  XLSX.writeFile(wb, `${file}.xlsx`);
}

export function downloadPdf(file: string, title: string, sheets: Sheet[]) {
  const doc = new jsPDF({ orientation: "landscape" });
  let y = 16;
  doc.setFontSize(16);
  doc.text(title, 14, y);
  doc.setFontSize(9);
  doc.text(`Moustarchidine Junior — généré le ${new Date().toLocaleDateString("fr-FR")}`, 14, y + 6);
  y += 14;
  sheets.forEach((s) => {
    doc.setFontSize(12);
    doc.text(s.name, 14, y);
    autoTable(doc, { startY: y + 3, head: [s.head], body: s.rows.map((r) => r.map(String)), styles: { fontSize: 8 }, headStyles: { fillColor: [17, 24, 39] } });
    y = (doc as any).lastAutoTable.finalY + 12;
    if (y > 180) { doc.addPage(); y = 16; }
  });
  doc.save(`${file}.pdf`);
}
