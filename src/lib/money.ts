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
