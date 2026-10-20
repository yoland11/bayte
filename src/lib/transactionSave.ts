import type { Transaction } from './types';

// IDs belong to the form's intent, not to an individual network attempt.
export function createTransactionDraft(existing?: Transaction) {
  const id = existing?.id ?? crypto.randomUUID();
  const createdAt = existing?.createdAt ?? Date.now();
  let lastKey: string | undefined;
  let lastFile: File | null | undefined;
  let operationId = '';
  return { id, createdAt, operationFor(record: Transaction, file?: File | null, removeAttachment = false): string {
    const { updatedAt: _updatedAt, ...persisted } = record;
    const key = JSON.stringify({ persisted, removeAttachment });
    if (key !== lastKey || file !== lastFile) { operationId = crypto.randomUUID(); lastKey = key; lastFile = file; }
    return operationId;
  } };
}
export class SaveConfirmationPendingError extends Error {
  constructor() { super('save-confirmation-pending'); }
}
export class TransactionConflictError extends Error {
  constructor() { super('transaction-conflict'); }
}
export interface TransactionSaveResult { saved: true; cleanupPending: boolean }
