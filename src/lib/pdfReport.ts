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

export const PDF_TABLE_COLUMNS = [
  { key: 'balance', label: 'الرصيد', width: 29 },
  { key: 'expense', label: 'الصرف', width: 29 },
  { key: 'income', label: 'القبض', width: 29 },
  { key: 'stage', label: 'مرحلة البناء', width: 25 },
  { key: 'category', label: 'التصنيف', width: 25 },
  { key: 'person', label: 'العميل / الشخص', width: 34 },
  { key: 'description', label: 'البيان', width: 68 },
  { key: 'date', label: 'التاريخ', width: 27 },
  { key: 'sequence', label: 'م', width: 15 }
] as const;

export function formatPdfAmount(amount: number): string {
  return formatAmount(amount).replace(/[\u061c\u200e\u200f]/g, '');
}

export function buildPdfReportModel(data: PdfReportData): PdfReportModel {
  const ordered = [...data.records].sort((a, b) => a.date.localeCompare(b.date));
  const rows = ordered.map((record, index) => [
    formatPdfAmount(record.balance), formatPdfAmount(record.expense), formatPdfAmount(record.income), record.stage,
    record.category, record.person, record.description, record.date, formatPdfAmount(index + 1)
  ]);
  const totals = [
    formatPdfAmount(data.closingBalance), formatPdfAmount(data.sums.expenses), formatPdfAmount(data.sums.income),
    '', '', '', 'الإجماليات', '', ''
  ];
  const summary = [
    { label: 'الرصيد السابق', value: formatPdfAmount(data.openingBalance) },
    { label: 'إجمالي القبض', value: formatPdfAmount(data.sums.income) },
    { label: 'إجمالي الصرف', value: formatPdfAmount(data.sums.expenses) },
    { label: 'الرصيد الختامي', value: formatPdfAmount(data.closingBalance) }
  ];
  return { columns: PDF_TABLE_COLUMNS.map(({ key, label }) => ({ key, label })), rows, totals, summary };
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
  const pageMargin = 8;
  const contentWidth = pageWidth - pageMargin * 2;
  const headerBottom = data.clientName ? 40 : 34;
  const summaryTop = headerBottom + 5;
  const sectionTitleY = summaryTop + 22;
  const tableHeadY = summaryTop + 28;
  const continuationTop = 20;
  const footerMargin = 13;

  writeRight(doc, data.title, pageWidth - pageMargin, 12, 14, true);
  writeRight(doc, `المشروع: ${data.projectName}`, pageWidth - pageMargin, 19, 8.3);
  if (data.clientName) writeRight(doc, `العميل: ${data.clientName}`, pageWidth - pageMargin, 25, 8.3);
  const periodY = data.clientName ? 31 : 25;
  writeRight(doc, 'الفترة:', pageWidth - pageMargin, periodY, 8.3);
  doc.setFont(/[؀-ۿ]/.test(data.period) ? FONT_NAME : 'helvetica', 'normal'); doc.setFontSize(8.3);
  doc.text(data.period, pageWidth - 26, periodY, { align: 'right' });

  doc.setDrawColor(145, 145, 145);
  doc.setLineWidth(0.18);
  doc.line(pageMargin, headerBottom, pageWidth - pageMargin, headerBottom);

  const summaryWidth = (pageWidth - 16) / model.summary.length;
  doc.setDrawColor(160, 160, 160);
  doc.setLineWidth(0.18);
  doc.rect(pageMargin, summaryTop, contentWidth, 16);
  model.summary.forEach((item, index) => {
    const center = pageWidth - 8 - summaryWidth * (index + 0.5);
    doc.setFont(FONT_NAME, 'normal'); doc.setFontSize(8);
    doc.text(item.label, center, summaryTop + 5.5, { align: 'center' });
    writeMoney(doc, item.value, center, summaryTop + 12.1, 9, true);
    if (index > 0) {
      doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.15);
      const dividerX = pageWidth - 8 - summaryWidth * index;
      doc.line(dividerX, summaryTop, dividerX, summaryTop + 16);
    }
  });

  doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.18);
  doc.rect(pageMargin, sectionTitleY - 5, contentWidth, 8);
  writeRight(doc, 'تفاصيل العمليات', pageWidth - pageMargin - 2, sectionTitleY + 0.2, 8.5, true);

  const drawRepeatedHead = (y: number) => {
    let x = pageMargin;
    doc.setFont(FONT_NAME, 'bold'); doc.setFontSize(7.2);
    for (const column of PDF_TABLE_COLUMNS) {
      doc.setFillColor(242, 242, 242); doc.setDrawColor(155, 155, 155); doc.setLineWidth(0.15);
      doc.rect(x, y, column.width, 8, 'FD');
      doc.text(column.label, x + column.width / 2, y + 5.1, { align: 'center', maxWidth: column.width - 2 });
      x += column.width;
    }
  };

  const head = [model.columns.map((column) => column.label)];
  const body: RowInput[] = model.rows.length ? model.rows : [['', '', '', '', '', '', 'لا توجد عمليات ضمن الفترة المحددة', '', '']];
  autoTable(doc, {
    head,
    body,
    foot: [model.totals],
    showHead: 'firstPage',
    showFoot: 'lastPage',
    startY: tableHeadY,
    margin: { left: pageMargin, right: pageMargin, top: continuationTop, bottom: footerMargin },
    tableWidth: contentWidth,
    theme: 'grid',
    styles: {
      font: FONT_NAME, fontStyle: 'normal', fontSize: 7, textColor: [0, 0, 0],
      lineColor: [155, 155, 155], lineWidth: 0.15, cellPadding: { top: 1.15, right: 1.5, bottom: 1.15, left: 1.3 },
      overflow: 'linebreak', valign: 'middle', halign: 'right', minCellHeight: 5.5
    },
    headStyles: { fillColor: [242, 242, 242], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', minCellHeight: 8 },
    footStyles: { fillColor: [248, 248, 248], textColor: [0, 0, 0], fontStyle: 'bold', lineWidth: 0.18, minCellHeight: 7.5 },
    columnStyles: Object.fromEntries(PDF_TABLE_COLUMNS.map((column, index) => [index, {
      cellWidth: column.width,
      ...(index <= 2 ? { halign: 'right', font: 'helvetica', overflow: 'visible' as const } : {}),
      ...(index === 7 || index === 8 ? { halign: 'center', font: 'helvetica' } : {})
    }])),
    rowPageBreak: 'avoid',
    willDrawPage: ({ pageNumber }) => {
      if (pageNumber === 1) return;
      drawRepeatedHead(continuationTop - 8);
    },
    didParseCell: (hook) => {
      if (hook.section === 'body' && model.rows.length === 0 && hook.column.index === 6) hook.cell.styles.halign = 'center';
    }
  });

  const categoryRows = data.expenseByCategory?.length
    ? data.expenseByCategory.map((row) => [formatPdfAmount(row.amount), row.name])
    : [[formatPdfAmount(0), 'لا توجد مصروفات']];
  const stageRows = data.expenseByStage?.length
    ? data.expenseByStage.map((row) => [formatPdfAmount(row.amount), row.name])
    : [[formatPdfAmount(0), 'لا توجد مصروفات']];
  const lastTableY = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? tableHeadY;
  let breakdownY = lastTableY + 7;
  if (breakdownY + 24 > pageHeight - footerMargin) {
    doc.addPage();
    breakdownY = 12;
  }
  const breakdownTable = (title: string, rows: string[][], side: 'left' | 'right') => {
    const halfWidth = (contentWidth - 8) / 2;
    const margin = side === 'right'
      ? { left: pageWidth / 2 + 4, right: pageMargin, top: 12, bottom: footerMargin }
      : { left: pageMargin, right: pageWidth / 2 + 4, top: 12, bottom: footerMargin };
    autoTable(doc, {
      head: [
        [{ content: title, colSpan: 2, styles: { halign: 'right', fillColor: [255, 255, 255], fontStyle: 'bold', fontSize: 9 } }],
        ['إجمالي الصرف', 'الاسم']
      ],
      body: rows,
      startY: breakdownY,
      margin,
      tableWidth: halfWidth,
      theme: 'grid',
      styles: { font: FONT_NAME, fontSize: 7.2, textColor: [0, 0, 0], lineColor: [155, 155, 155], lineWidth: 0.15, cellPadding: { top: 1.1, right: 1.5, bottom: 1.1, left: 1.2 }, halign: 'right', valign: 'middle', minCellHeight: 5.5 },
      headStyles: { fillColor: [242, 242, 242], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'center', minCellHeight: 7 },
      columnStyles: { 0: { cellWidth: 38, halign: 'right', font: 'helvetica', overflow: 'visible' }, 1: { cellWidth: halfWidth - 38, halign: 'right' } },
      showHead: 'everyPage',
      rowPageBreak: 'avoid'
    });
  };
  breakdownTable('الصرف حسب التصنيف', categoryRows, 'right');
  breakdownTable('الصرف حسب مرحلة البناء', stageRows, 'left');

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page);
    doc.setDrawColor(145, 145, 145); doc.setLineWidth(0.15);
    doc.line(pageMargin, pageHeight - 9, pageWidth - pageMargin, pageHeight - 9);
    doc.setFont(FONT_NAME, 'normal'); doc.setFontSize(7);
    doc.text('تاريخ الطباعة:', pageWidth - 8, pageHeight - 4, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(data.fileDate, pageWidth - 31, pageHeight - 4, { align: 'right' });
    doc.text(`${page} / ${pageCount}`, 8, pageHeight - 4, { align: 'left' });
  }

  return doc.output('blob');
}
