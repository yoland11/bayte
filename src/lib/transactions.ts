import type { Transaction, TransactionType } from './types';
import { normalizeDigits } from './money';

export interface TransactionFilters {
  query: string;
  type: TransactionType | 'all';
  categoryId?: string;
  stageId?: string;
  clientId?: string;
  minAmount?: string;
  maxAmount?: string;
  from?: string;
  to?: string;
  sort: 'newest' | 'oldest' | 'highest' | 'lowest';
}

function searchableText(transaction: Transaction): string {
  return normalizeDigits(`${transaction.description} ${transaction.person ?? ''} ${transaction.notes ?? ''}`).toLocaleLowerCase('ar');
}

export function filterAndSortTransactions(transactions: Transaction[], filters: TransactionFilters): Transaction[] {
  const query = normalizeDigits(filters.query.trim()).toLocaleLowerCase('ar');
  return transactions.filter((transaction) => {
    if (query && !searchableText(transaction).includes(query)) return false;
    if (filters.type !== 'all' && transaction.type !== filters.type) return false;
    if (filters.categoryId && transaction.categoryId !== filters.categoryId) return false;
    if (filters.stageId && transaction.stageId !== filters.stageId) return false;
    if (filters.clientId && transaction.clientId !== filters.clientId) return false;
    const minimum = filters.minAmount ? Number(normalizeDigits(filters.minAmount).replace(/,/g, '')) : undefined;
    const maximum = filters.maxAmount ? Number(normalizeDigits(filters.maxAmount).replace(/,/g, '')) : undefined;
    if (minimum !== undefined && Number.isFinite(minimum) && transaction.amount < minimum) return false;
    if (maximum !== undefined && Number.isFinite(maximum) && transaction.amount > maximum) return false;
    if (filters.from && transaction.date < filters.from) return false;
    if (filters.to && transaction.date > filters.to) return false;
    return true;
  }).sort((a, b) => {
    if (filters.sort === 'highest') return b.amount - a.amount || b.date.localeCompare(a.date);
    if (filters.sort === 'lowest') return a.amount - b.amount || b.date.localeCompare(a.date);
    const order = a.date.localeCompare(b.date) || a.createdAt - b.createdAt;
    return filters.sort === 'oldest' ? order : -order;
  });
}

export type Period = 'today' | 'week' | 'month' | 'year' | 'custom' | 'all';

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getPeriodBounds(period: Period, now = new Date(), customFrom = '', customTo = ''): { from?: string; to?: string } {
  if (period === 'all') return {};
  if (period === 'custom') return { from: customFrom || undefined, to: customTo || undefined };
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return { from: localDate(start), to: localDate(start) };
  if (period === 'week') {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: localDate(start), to: localDate(end) };
  }
  if (period === 'month') return { from: localDate(new Date(start.getFullYear(), start.getMonth(), 1)), to: localDate(new Date(start.getFullYear(), start.getMonth() + 1, 0)) };
  return { from: localDate(new Date(start.getFullYear(), 0, 1)), to: localDate(new Date(start.getFullYear(), 11, 31)) };
}
