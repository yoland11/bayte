import type { Summary } from './types';
import { formatAmount, formatCurrency } from './money';

export interface PdfReportRow {
  type: 'income' | 'expense';
  description: string;
  amount: number;
  date: string;
  category: string;
  stage: string;
  person: string;
}

export interface PdfReportData {
  fileDate: string;
  period: string;
  records: PdfReportRow[];
  sums: Summary;
  expenseByCategory?: { name: string; amount: number }[];
  expenseByStage?: { name: string; amount: number }[];
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));
}

export function buildPdfReportHtml({ fileDate, period, records, sums, expenseByCategory = [], expenseByStage = [] }: PdfReportData): string {
  const tableRows = records.length
    ? records.map((row, index) => `<tr><td class="pdf-index">${formatAmount(index + 1)}</td><td><span class="pdf-type ${row.type}">${row.type === 'income' ? 'قبض' : 'صرف'}</span></td><td class="pdf-description">${escapeHtml(row.description)}</td><td class="pdf-amount">${formatCurrency(row.amount)}</td><td class="pdf-date-cell">${escapeHtml(row.date)}</td><td>${escapeHtml(row.category)}</td><td>${escapeHtml(row.stage)}</td><td>${escapeHtml(row.person)}</td></tr>`).join('')
    : '<tr class="pdf-empty-row"><td colspan="8">لا توجد عمليات ضمن الفترة المحددة</td></tr>';
  const breakdown = (title: string, rows: { name: string; amount: number }[]) => rows.length ? `<section class="pdf-breakdown"><h2>${title}</h2><table><thead><tr><th>الاسم</th><th>إجمالي الصرف</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.name)}</td><td class="pdf-amount">${formatCurrency(row.amount)}</td></tr>`).join('')}</tbody></table></section>` : '';

  return `<div class="pdf-report" dir="rtl">
    <header class="pdf-report-header">
      <div class="pdf-brand"><span class="pdf-brand-mark">ب</span><div><h1>بيتي</h1><p>تقرير العمليات المالية</p></div></div>
      <div class="pdf-meta-grid">
        <div class="pdf-meta-cell"><span>تاريخ التصدير</span><b>${escapeHtml(fileDate)}</b></div>
        <div class="pdf-meta-cell"><span>الفترة المحددة</span><b>${escapeHtml(period)}</b></div>
        <div class="pdf-meta-cell"><span>عدد العمليات</span><b>${formatAmount(records.length)} عملية</b></div>
      </div>
    </header>
    <section class="pdf-summary" aria-label="ملخص التقرير">
      <div class="pdf-summary-card income"><span>إجمالي القبض</span><b>${formatCurrency(sums.income)}</b></div>
      <div class="pdf-summary-card expense"><span>إجمالي الصرف</span><b>${formatCurrency(sums.expenses)}</b></div>
      <div class="pdf-summary-card balance"><span>الرصيد الحالي</span><b>${formatCurrency(sums.balance)}</b></div>
    </section>
    <section class="pdf-table-section">
      <div class="pdf-table-heading"><h2>تفاصيل العمليات</h2><span>سجل مالي مرتب حسب التاريخ</span></div>
      <table><thead><tr><th>م</th><th>النوع</th><th>البيان</th><th>المبلغ</th><th>التاريخ</th><th>التصنيف</th><th>المرحلة</th><th>المورد / الشخص</th></tr></thead><tbody>${tableRows}</tbody></table>
    </section>
    ${(expenseByCategory.length || expenseByStage.length) ? `<section class="pdf-breakdown-grid">${breakdown('الصرف حسب التصنيف', expenseByCategory)}${breakdown('الصرف حسب مرحلة البناء', expenseByStage)}</section>` : ''}
    <footer>بيتي <span>·</span> تقرير متابعة بناء البيت</footer>
  </div>`;
}
