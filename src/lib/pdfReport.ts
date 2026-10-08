import { jsPDF } from 'jspdf';
import { autoTable, type RowInput } from 'jspdf-autotable';
import { formatAmount } from './money';
import type { Summary } from './types';

export interface PdfReportRow {
  date: string;
  description: string;
  person: string;
  category: string;
  stage: string;
  income: number;
  expense: number;
  balance: number;
}

export interface PdfReportData {
  title: string;
  projectName: string;
  clientName?: string;
  fileDate: string;
  period: string;
  openingBalance: number;
  closingBalance: number;
  records: PdfReportRow[];
  sums: Summary;
  expenseByCategory?: { name: string; amount: number }[];
  expenseByStage?: { name: string; amount: number }[];
}

export interface PdfReportModel {
  columns: { key: string; label: string }[];
  rows: string[][];
  totals: string[];
  summary: { label: string; value: string }[];
}

const COLUMNS = [
  { key: 'balance', label: 'الرصيد' },
  { key: 'expense', label: 'الصرف' },
  { key: 'income', label: 'القبض' },
  { key: 'stage', label: 'مرحلة البناء' },
  { key: 'category', label: 'التصنيف' },
  { key: 'person', label: 'العميل / الشخص' },
  { key: 'description', label: 'البيان' },
  { key: 'date', label: 'التاريخ' },
  { key: 'sequence', label: 'م' }
] as const;

export function buildPdfReportModel(data: PdfReportData): PdfReportModel {
  const ordered = [...data.records].sort((a, b) => a.date.localeCompare(b.date));
  const rows = ordered.map((record, index) => [
    formatAmount(record.balance), formatAmount(record.expense), formatAmount(record.income), record.stage,
    record.category, record.person, record.description, record.date, formatAmount(index + 1)
  ]);
  const totals = [
    formatAmount(data.closingBalance), formatAmount(data.sums.expenses), formatAmount(data.sums.income),
    '', '', '', 'الإجماليات', '', ''
  ];
  const summary = [
    { label: 'الرصيد السابق', value: formatAmount(data.openingBalance) },
    { label: 'إجمالي القبض', value: formatAmount(data.sums.income) },
    { label: 'إجمالي الصرف', value: formatAmount(data.sums.expenses) },
    { label: 'الرصيد الختامي', value: formatAmount(data.closingBalance) }
  ];
  return { columns: COLUMNS.map(({ key, label }) => ({ key, label })), rows, totals, summary };
}

const FONT_NAME = 'NotoNaskhArabic';
const FONT_FILE = 'NotoNaskhArabic.ttf';

async function getFontBase64(): Promise<string> {
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/${FONT_FILE}`);
  if (!response.ok) throw new Error('Arabic PDF font could not be loaded');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let start = 0; start < bytes.length; start += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(start, Math.min(start + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

function installFont(doc: jsPDF, fontBase64: string) {
  doc.addFileToVFS(FONT_FILE, fontBase64);
  doc.addFont(FONT_FILE, FONT_NAME, 'normal');
  doc.addFont(FONT_FILE, FONT_NAME, 'bold');
  doc.setFont(FONT_NAME, 'normal');
}

function writeRight(doc: jsPDF, text: string, x: number, y: number, size: number, bold = false) {
  doc.setFont(FONT_NAME, bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.text(text, x, y, { align: 'right', maxWidth: 281 });
}

function writeMoney(doc: jsPDF, text: string, x: number, y: number, size: number, bold = false) {
  doc.setFont('helvetica', bold ? 'bold' : 'normal');
  doc.setFontSize(size);
  doc.text(text, x, y, { align: 'center' });
  doc.setFont(FONT_NAME, 'normal');
}

export async function createPdfReport(data: PdfReportData, fontBase64?: string): Promise<Blob> {
  const model = buildPdfReportModel(data);
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  installFont(doc, fontBase64 ?? await getFontBase64());
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = { left: 8, right: 8, top: 45, bottom: 13 };

  writeRight(doc, data.title, pageWidth - 8, 12, 14, true);
  writeRight(doc, `المشروع: ${data.projectName}`, pageWidth - 8, 19, 8.3);
  if (data.clientName) writeRight(doc, `العميل: ${data.clientName}`, pageWidth - 8, 25, 8.3);
  const periodY = data.clientName ? 31 : 25;
  writeRight(doc, 'الفترة:', pageWidth - 8, periodY, 8.3);
  doc.setFont(/[؀-ۿ]/.test(data.period) ? FONT_NAME : 'helvetica', 'normal'); doc.setFontSize(8.3);
  doc.text(data.period, pageWidth - 26, periodY, { align: 'right' });
  doc.setDrawColor(90, 90, 90);
  doc.setLineWidth(0.2);
  doc.line(8, 34, pageWidth - 8, 34);

  const summaryTop = 39;
  const summaryWidth = (pageWidth - 16) / model.summary.length;
  model.summary.forEach((item, index) => {
    const center = pageWidth - 8 - summaryWidth * (index + 0.5);
    doc.setFont(FONT_NAME, 'normal'); doc.setFontSize(8);
    doc.text(item.label, center, summaryTop, { align: 'center' });
    writeMoney(doc, item.value, center, summaryTop + 5.2, 9, true);
    if (index > 0) {
      doc.setDrawColor(190, 190, 190); doc.setLineWidth(0.15);
      const dividerX = pageWidth - 8 - summaryWidth * index;
      doc.line(dividerX, summaryTop - 3, dividerX, summaryTop + 8);
    }
  });

  const head = [model.columns.map((column) => column.label)];
  const body: RowInput[] = model.rows.length ? model.rows : [['', '', '', '', '', '', 'لا توجد عمليات ضمن الفترة المحددة', '', '']];
  autoTable(doc, {
    head,
    body,
    foot: [model.totals],
    showHead: 'firstPage',
    showFoot: 'lastPage',
    startY: margin.top,
    margin: { ...margin, top: 54 },
    theme: 'grid',
    styles: {
      font: FONT_NAME, fontStyle: 'normal', fontSize: 6.8, textColor: [0, 0, 0],
      lineColor: [135, 135, 135], lineWidth: 0.15, cellPadding: { top: 1.1, right: 1.2, bottom: 1.1, left: 1.2 },
      overflow: 'linebreak', valign: 'middle', halign: 'right', minCellHeight: 5.5
    },
    headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', minCellHeight: 7 },
    footStyles: { fillColor: [242, 242, 242], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.2, minCellHeight: 7.5 },
    columnStyles: {
      0: { cellWidth: 29, halign: 'center', font: 'helvetica' },
      1: { cellWidth: 28, halign: 'center', font: 'helvetica' },
      2: { cellWidth: 28, halign: 'center', font: 'helvetica' },
      3: { cellWidth: 28 },
      4: { cellWidth: 27 },
      5: { cellWidth: 31 },
      6: { cellWidth: 66 },
      7: { cellWidth: 28, halign: 'center', font: 'helvetica' },
      8: { cellWidth: 16, halign: 'center', font: 'helvetica' }
    },
    rowPageBreak: 'avoid',
    willDrawPage: ({ pageNumber }) => {
      if (pageNumber === 1) return;
      let x = margin.left;
      const widths = [29, 28, 28, 28, 27, 31, 66, 28, 16];
      doc.setFont(FONT_NAME, 'bold'); doc.setFontSize(6.8);
      model.columns.forEach((column, index) => {
        const width = widths[index];
        doc.setFillColor(235, 235, 235); doc.setDrawColor(135, 135, 135); doc.setLineWidth(0.15);
        doc.rect(x, margin.top - 9, width, 9, 'FD');
        doc.text(column.label, x + width / 2, margin.top - 3.3, { align: 'center', maxWidth: width - 2 });
        x += width;
      });
    },
    didParseCell: (hook) => {
      if (hook.section === 'body' && model.rows.length === 0 && hook.column.index === 6) hook.cell.styles.halign = 'center';
    }
  });

  const byCategory = data.expenseByCategory ?? [];
  const byStage = data.expenseByStage ?? [];
  for (const [title, breakdown] of [['الصرف حسب التصنيف', byCategory], ['الصرف حسب مرحلة البناء', byStage]] as const) {
    if (!breakdown.length) continue;
    const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? margin.top;
    const startY = y + 8;
    if (startY > pageHeight - 35) doc.addPage();
    const effectiveY = startY > pageHeight - 35 ? 14 : startY;
    writeRight(doc, title, pageWidth - 8, effectiveY, 9, true);
    autoTable(doc, {
      head: [['الاسم', 'إجمالي الصرف (د.ع)']],
      body: breakdown.map((row) => [row.name, formatAmount(row.amount)]),
      startY: effectiveY + 2,
      margin: { left: pageWidth / 2, right: 8, bottom: margin.bottom },
      theme: 'grid',
      styles: { font: FONT_NAME, fontSize: 7.5, textColor: [0, 0, 0], lineColor: [135, 135, 135], lineWidth: 0.15, cellPadding: 1.5, halign: 'right' },
      headStyles: { fillColor: [235, 235, 235], textColor: [0, 0, 0], fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'center', font: 'helvetica' } },
      showHead: 'everyPage', rowPageBreak: 'avoid'
    });
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(145, 145, 145); doc.setLineWidth(0.15);
    doc.line(8, pageHeight - 9, pageWidth - 8, pageHeight - 9);
    doc.setFont(FONT_NAME, 'normal'); doc.setFontSize(7);
    doc.text('تاريخ الطباعة:', pageWidth - 8, pageHeight - 4, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(data.fileDate, pageWidth - 31, pageHeight - 4, { align: 'right' });
    doc.text(`${page} / ${pageCount}`, 8, pageHeight - 4, { align: 'left' });
  }

  return doc.output('blob');
}
