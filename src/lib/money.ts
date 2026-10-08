import type { Summary, Transaction } from './types';

const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const arabic = ARABIC_DIGITS.indexOf(digit);
    return String(arabic >= 0 ? arabic : PERSIAN_DIGITS.indexOf(digit));
  });
}

export function parseAmount(value: string): number {
  const normalized = normalizeDigits(value.trim())
    .replace(/[٬,\s]/g, '')
    .replace(/٫/g, '.')
    .replace(/[^\d.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return 0;
  const number = Number(normalized);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

const amountFormatter = new Intl.NumberFormat('ar-IQ-u-nu-latn', {
  maximumFractionDigits: 2,
  useGrouping: true
});

export function formatAmount(amount: number): string {
  return amountFormatter.format(Number.isFinite(amount) ? amount : 0);
}

export function formatCurrency(amount: number): string {
  return `${formatAmount(amount)} د.ع`;
}

export function summarizeTransactions(transactions: Transaction[]): Summary {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const transaction of transactions) {
    const cents = Math.round(transaction.amount * 100);
    if (transaction.type === 'income') incomeCents += cents;
    else expenseCents += cents;
  }
  const income = incomeCents / 100;
  const expenses = expenseCents / 100;
  return { income, expenses, balance: (incomeCents - expenseCents) / 100 };
}

export function sumAmounts(amounts: number[]): number {
  return amounts.reduce((totalCents, amount) => totalCents + Math.round(amount * 100), 0) / 100;
}

export interface LedgerRow {
  transaction: Transaction;
  balanceAfter: number;
}

export function calculateLedgerRows(
  allRecords: Transaction[],
  visibleRecords: Transaction[],
  range: { from?: string; to?: string } = {}
): { openingBalance: number; rows: LedgerRow[]; closingBalance: number } {
  const chronological = [...allRecords].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  let openingCents = 0;
  let closingCents = 0;
  const visibleIds = new Set(visibleRecords.map((record) => record.id));
  const rows: LedgerRow[] = [];
  let runningCents = 0;

  for (const transaction of chronological) {
    const cents = Math.round(transaction.amount * 100) * (transaction.type === 'income' ? 1 : -1);
    if (range.from && transaction.date < range.from) openingCents += cents;
    if (!range.to || transaction.date <= range.to) closingCents += cents;
    runningCents += cents;
    if (visibleIds.has(transaction.id) && (!range.from || transaction.date >= range.from) && (!range.to || transaction.date <= range.to)) {
      rows.push({ transaction, balanceAfter: runningCents / 100 });
    }
  }

  return { openingBalance: openingCents / 100, rows, closingBalance: closingCents / 100 };
}
