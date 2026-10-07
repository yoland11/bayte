import { describe, expect, it } from 'vitest';
import { arrangeDashboardCards, summarizeClientStatement } from './workspaceFeatures';
import type { Transaction } from './types';

const records: Transaction[] = [
  { id: 'one', type: 'income', amount: 100, description: 'دفعة', date: '2026-10-01', clientId: 'client-a', createdAt: 1, updatedAt: 1 },
  { id: 'two', type: 'expense', amount: 35, description: 'مواد', date: '2026-10-02', clientId: 'client-a', createdAt: 2, updatedAt: 2 },
  { id: 'three', type: 'expense', amount: 80, description: 'مصروف عام', date: '2026-10-03', createdAt: 3, updatedAt: 3 }
];

describe('client statements', () => {
  it('summarizes only the selected client and computes receipts minus payments', () => {
    expect(summarizeClientStatement(records, 'client-a')).toEqual({ income: 100, expenses: 35, balance: 65, transactions: records.slice(0, 2).reverse() });
  });

  it('adds decimal client amounts in integer cents', () => {
    const decimals = [
      { ...records[0], amount: 0.1 },
      { ...records[1], amount: 0.2, type: 'income' as const }
    ];
    expect(summarizeClientStatement(decimals, 'client-a')).toMatchObject({ income: 0.3, expenses: 0, balance: 0.3 });
  });
});

describe('dashboard card ordering', () => {
  it('keeps each supported card once and appends missing cards in default order', () => {
    expect(arrangeDashboardCards(['expense', 'expense', 'unknown'], ['balance', 'income', 'expense']))
      .toEqual(['expense', 'balance', 'income']);
  });
});
