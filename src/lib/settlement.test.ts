import { expect, it } from 'vitest';
import { parseSettlement, settlementAmounts } from './settlement';
import { summarizeTransactions } from './money';
import type { Transaction } from './types';

it('keeps the unpaid purchase out of cash totals', () => {
  const amounts = parseSettlement('١.٠٠٠.٠٠٠', '٥٠٠.٠٠٠')!;
  expect(settlementAmounts(amounts)).toEqual({ total: 1000000, paid: 500000, remaining: 500000 });
  expect(summarizeTransactions([{ ...amounts, type: 'expense' } as Transaction]).balance).toBe(-500000);
});

it('supports full payment by default and explicit zero payment', () => {
  expect(parseSettlement('1,000,000', '')).toEqual({ amount: 1000000, totalAmount: 1000000 });
  expect(parseSettlement('1,000,000', '0')).toEqual({ amount: 0, totalAmount: 1000000 });
});

it('rejects invalid amounts and keeps legacy records fully paid', () => {
  expect(parseSettlement('100', '101')).toBeNull();
  expect(parseSettlement('100', 'abc')).toBeNull();
  expect(parseSettlement('100', '-1')).toBeNull();
  expect(settlementAmounts({ amount: 175000 })).toEqual({ total: 175000, paid: 175000, remaining: 0 });
  expect(settlementAmounts({ amount: 0.1, totalAmount: 0.3 }).remaining).toBe(0.2);
});
