import { describe, expect, it } from 'vitest';
import { buildPdfReportModel } from './pdfReport';

describe('accounting PDF model', () => {
  it('uses the nine accounting columns in RTL visual order and English numerals', () => {
    const model = buildPdfReportModel({
      title: 'كشف حساب عام', projectName: 'بيتي', period: '2026-10-01 — 2026-10-31', fileDate: '2026-10-09',
      openingBalance: 5_000_000, closingBalance: 5_750_000,
      sums: { income: 1_000_000, expenses: 250_000, balance: 750_000 },
      records: [{ date: '2026-10-02', description: 'دفعة حديد', person: 'علي', category: 'مواد', stage: 'الأساس', income: 1_000_000, expense: 250_000, balance: 5_750_000 }]
    });

    expect(model.columns.map((column) => column.label)).toEqual([
      'الرصيد', 'الصرف', 'القبض', 'مرحلة البناء', 'التصنيف', 'العميل / الشخص', 'البيان', 'التاريخ', 'م'
    ]);
    expect(model.rows[0]).toEqual(['5,750,000', '250,000', '1,000,000', 'الأساس', 'مواد', 'علي', 'دفعة حديد', '2026-10-02', '1']);
    expect(model.totals).toEqual(['5,750,000', '250,000', '1,000,000', '', '', '', 'الإجماليات', '', '']);
    expect(model.summary.map((item) => item.value)).toEqual(['5,000,000', '1,000,000', '250,000', '5,750,000']);
  });
});
