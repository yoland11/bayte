import { describe, expect, it } from 'vitest';
import { filterAndSortTransactions } from './transactions';
import type { Transaction } from './types';

const transactions: Transaction[] = [
  { id: 'a', type: 'expense', amount: 8000, description: 'شراء إسمنت', person: 'مورد البناء', notes: 'الدفع نقداً', categoryId: 'cement', stageId: 'roof', date: '2026-10-02', createdAt: 1, updatedAt: 1 },
  { id: 'b', type: 'income', amount: 90000, description: 'دفعة ثانية', person: 'أبو علي', date: '2026-10-01', createdAt: 2, updatedAt: 2 },
  { id: 'c', type: 'expense', amount: 2000, description: 'حديد', categoryId: 'steel', stageId: 'roof', date: '2026-09-28', createdAt: 3, updatedAt: 3 }
];

describe('transaction filters', () => {
  it('combines search, type, category, stage, and date bounds', () => {
    const result = filterAndSortTransactions(transactions, {
      query: 'نقداً', type: 'expense', categoryId: 'cement', stageId: 'roof', from: '2026-10-01', to: '2026-10-07', sort: 'newest'
    });
    expect(result.map((item) => item.id)).toEqual(['a']);
  });

  it('searches descriptions and supplier/person fields, and sorts by transaction date', () => {
    expect(filterAndSortTransactions(transactions, { query: 'أبو', type: 'all', sort: 'oldest' }).map((item) => item.id)).toEqual(['b']);
    expect(filterAndSortTransactions(transactions, { query: '', type: 'all', sort: 'oldest' }).map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });
});
