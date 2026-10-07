import { describe, expect, it } from 'vitest';
import { buildPdfReportHtml } from './pdfReport';

const example = {
  fileDate: '2026-10-07',
  period: 'كل الفترات',
  records: [{ type: 'expense' as const, description: '<شراء حديد>', amount: 1250, date: '7 تشرين الأول 2026', category: 'حديد', stage: 'الأساس', person: 'المورد' }],
  sums: { income: 2000, expenses: 1250, balance: 750 }
};

describe('PDF report layout', () => {
  it('lays out report details in metadata cells, summary cards, and a numbered table', () => {
    const html = buildPdfReportHtml(example);
    expect(html).toContain('class="pdf-meta-grid"');
    expect(html).toContain('class="pdf-summary"');
    expect(html).toContain('<th>م</th>');
    expect(html).toContain('class="pdf-table-heading"');
    expect(html).toContain('class="pdf-amount"');
  });

  it('escapes transaction text and provides an explicit empty state', () => {
    const populatedHtml = buildPdfReportHtml(example);
    const emptyHtml = buildPdfReportHtml({ ...example, records: [] });
    expect(populatedHtml).not.toContain('<شراء حديد>');
    expect(populatedHtml).toContain('&lt;شراء حديد&gt;');
    expect(emptyHtml).toContain('لا توجد عمليات ضمن الفترة المحددة');
  });
});
