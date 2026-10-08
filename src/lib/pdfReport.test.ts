import { describe, expect, it } from 'vitest';
import { buildPdfReportModel, PDF_TABLE_COLUMNS } from './pdfReport';

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

  it('keeps negative signs attached and zero compact in every financial PDF cell', () => {
    const model = buildPdfReportModel({
      title: 'كشف حساب عام', projectName: 'بيتي', period: 'كل الفترات', fileDate: '2026-10-09',
      openingBalance: 0, closingBalance: -44_258_954,
      sums: { income: 55, expenses: 44_259_009, balance: -44_258_954 },
      records: [{ date: '2026-10-09', description: 'تسديد مواد البناء', person: '—', category: '—', stage: '—', income: 0, expense: 10_000_000, balance: -44_258_954 }]
    });

    expect(model.rows[0].slice(0, 3)).toEqual(['-44,258,954', '10,000,000', '0']);
    expect(model.totals.slice(0, 3)).toEqual(['-44,258,954', '44,259,009', '55']);
    expect(model.summary.map((item) => item.value)).toEqual(['0', '55', '44,259,009', '-44,258,954']);
    expect([...model.rows[0], ...model.totals, ...model.summary.map((item) => item.value)].every((value) => !/\d\s+[,\d]|[, ]\s+\d|^-\s/.test(value))).toBe(true);
  });

  it('uses equal financial columns and fills the A4 landscape width exactly', () => {
    const widths = Object.fromEntries(PDF_TABLE_COLUMNS.map(({ key, width }) => [key, width]));
    expect(Object.values(widths).reduce((total, width) => total + width, 0)).toBe(281);
    expect(widths.balance).toBe(widths.income);
    expect(widths.income).toBe(widths.expense);
    expect(widths.description).toBeGreaterThan(widths.person);
  });
});
