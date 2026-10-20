import { expect, it } from 'vitest';
import { createTransactionDraft } from './transactionSave';
const fields = { type: 'expense' as const, amount: 175000, date: '2026-10-18', description: 'isolated fixture' };
it('keeps the transaction and operation IDs stable across retries despite clock changes', () => {
  const draft = createTransactionDraft();
  const row = { ...fields, id: draft.id, createdAt: draft.createdAt, updatedAt: 1 };
  const first = draft.operationFor(row, null);
  expect(draft.operationFor({ ...row, updatedAt: 999 }, null)).toBe(first);
  expect(draft.id).toBe(row.id);
});
it('allocates a new operation only when the save intent changes', () => {
  const draft = createTransactionDraft();
  const row = { ...fields, id: draft.id, createdAt: draft.createdAt, updatedAt: 1 };
  expect(draft.operationFor({ ...row, amount: 275000 })).not.toBe(draft.operationFor(row));
  const a = draft.operationFor(row, new File(['a'], 'same.pdf'));
  expect(draft.operationFor(row, new File(['b'], 'same.pdf'))).not.toBe(a);
});
it('preserves the existing identity and creation date for edits', () => {
  const row = { ...fields, id: crypto.randomUUID(), createdAt: 1, updatedAt: 2 };
  expect(createTransactionDraft(row)).toMatchObject({ id: row.id, createdAt: 1 });
});
