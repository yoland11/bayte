import { normalizeDigits } from './money';
import type { Transaction } from './types';

const MAX_AMOUNT = 999_999_999_999.99;

export function normalizeAmountGrouping(value: string): string {
  const text = normalizeDigits(value.trim());
  return /^\d{1,3}(?:\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text;
}

function readAmount(value: string): number | null {
  const text = normalizeAmountGrouping(value).replace(/[٬,\s]/g, '').replace(/٫/g, '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(text)) return null;
  const amount = Number(text);
  return amount <= MAX_AMOUNT ? amount : null;
}

export function validSettlement(amount: unknown, totalAmount?: unknown): boolean {
  const total = totalAmount === undefined ? amount : totalAmount;
  return typeof amount === 'number' && typeof total === 'number' &&
    Number.isFinite(amount) && Number.isFinite(total) && amount >= 0 && total > 0 &&
    total <= MAX_AMOUNT && amount <= total;
}

export function parseSettlement(totalText: string, paidText: string): Pick<Transaction, 'amount' | 'totalAmount'> | null {
  const total = readAmount(totalText);
  const paid = paidText.trim() ? readAmount(paidText) : total;
  if (paid === null || total === null || !validSettlement(paid, total)) return null;
  return { amount: paid, totalAmount: total };
}

export function settlementAmounts(record: Pick<Transaction, 'amount' | 'totalAmount'>) {
  const total = record.totalAmount ?? record.amount;
  return { total, paid: record.amount, remaining: (Math.round(total * 100) - Math.round(record.amount * 100)) / 100 };
}
