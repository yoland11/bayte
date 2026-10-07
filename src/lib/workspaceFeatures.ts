import { summarizeTransactions } from './money';
import type { Transaction, Summary } from './types';

export type DashboardCard = 'balance' | 'income' | 'expense';

export function summarizeClientStatement(records: Transaction[], clientId: string): Summary & { transactions: Transaction[] } {
  const transactions = records.filter((record) => record.clientId === clientId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return { ...summarizeTransactions(transactions), transactions };
}

export function arrangeDashboardCards(saved: unknown, defaults: DashboardCard[]): DashboardCard[] {
  const allowed = new Set(defaults);
  const ordered = Array.isArray(saved) ? saved.filter((item): item is DashboardCard => typeof item === 'string' && allowed.has(item as DashboardCard)) : [];
  return [...new Set(ordered), ...defaults.filter((item) => !ordered.includes(item))];
}
