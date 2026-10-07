import { describe, expect, it } from 'vitest';
import { formatAmount, formatCurrency, parseAmount, summarizeTransactions, sumAmounts } from './money';
import type { Transaction } from './types';

const records: Transaction[] = [
  { id: '1', type: 'income', amount: 9_000_000, description: 'دفعة', date: '2026-10-01', createdAt: 1, updatedAt: 1 },
  { id: '2', type: 'expense', amount: 1_250_000, description: 'إسمنت', date: '2026-10-02', createdAt: 2, updatedAt: 2 },
  { id: '3', type: 'expense', amount: 500_000, description: 'حديد', date: '2026-10-03', createdAt: 3, updatedAt: 3 }
];

describe('money utilities', () => {
  it('normalizes Arabic and English digits and grouping separators into a numeric amount', () => {
    expect(parseAmount('٩،٠٠٠،٠٠٠')).toBe(9_000_000);
    expect(parseAmount('1,250,000')).toBe(1_250_000);
    expect(parseAmount('١٢٥٠٫٥')).toBe(1250.5);
  });

  it('formats amounts with English numerals and grouping without adding empty decimals', () => {
    expect(formatAmount(9_000_000)).toBe('9,000,000');
    expect(formatAmount(1250.5)).toBe('1,250.5');
    expect(formatCurrency(500_000)).toBe('500,000 د.ع');
  });

  it('adds decimal amounts in integer cents to avoid floating point drift', () => {
    const decimalRecords = [
      { ...records[0], amount: 0.1 },
      { ...records[1], amount: 0.2 }
    ];
    expect(summarizeTransactions(decimalRecords)).toEqual({ income: 0.1, expenses: 0.2, balance: -0.1 });
  });

  it('sums grouped report values in integer cents', () => {
    expect(sumAmounts([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('calculates income, expenses, and balance from numeric transaction values', () => {
    expect(summarizeTransactions(records)).toEqual({ income: 9_000_000, expenses: 1_750_000, balance: 7_250_000 });
  });

  it('checks the migration sample totals without adding seed data to a live project', () => {
    const sample: Transaction[] = [
      { id: 'sample-in-1', type: 'income', amount: 1_000_000, description: 'test', date: '2026-10-01', createdAt: 1, updatedAt: 1 },
      { id: 'sample-in-2', type: 'income', amount: 500_000, description: 'test', date: '2026-10-02', createdAt: 2, updatedAt: 2 },
      { id: 'sample-out-1', type: 'expense', amount: 250_000, description: 'test', date: '2026-10-03', createdAt: 3, updatedAt: 3 },
      { id: 'sample-out-2', type: 'expense', amount: 150_000, description: 'test', date: '2026-10-04', createdAt: 4, updatedAt: 4 }
    ];
    expect(summarizeTransactions(sample)).toEqual({ income: 1_500_000, expenses: 400_000, balance: 1_100_000 });
  });
});
