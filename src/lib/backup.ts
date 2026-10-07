import type { NamedOption, Transaction, StoredAttachment } from './types';

export interface BackupAttachment extends Omit<StoredAttachment, 'blob'> { data: string }
export interface BaytiBackup {
  version: 1;
  exportedAt: string;
  transactions: Transaction[];
  categories: NamedOption[];
  stages: NamedOption[];
  attachments: BackupAttachment[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
function isOption(value: unknown): value is NamedOption {
  return isObject(value) && isId(value.id) && typeof value.name === 'string' && isTime(value.createdAt) && isTime(value.updatedAt);
}
function isTransaction(value: unknown): value is Transaction {
  return isObject(value) && isId(value.id) && (value.type === 'income' || value.type === 'expense') &&
    typeof value.amount === 'number' && Number.isFinite(value.amount) && value.amount > 0 && typeof value.description === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.date)) && isTime(value.createdAt) && isTime(value.updatedAt) &&
    (value.categoryId === undefined || isId(value.categoryId)) && (value.stageId === undefined || isId(value.stageId)) &&
    (value.person === undefined || typeof value.person === 'string') && (value.notes === undefined || typeof value.notes === 'string') &&
    (value.attachmentId === undefined || isId(value.attachmentId));
}
function isAttachment(value: unknown): value is BackupAttachment {
  return isObject(value) && isId(value.id) && isId(value.transactionId) && typeof value.fileName === 'string' &&
    typeof value.fileType === 'string' && isTime(value.createdAt) && typeof value.data === 'string' &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data);
}

export function decodeBackup(text: string): BaytiBackup {
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { throw new Error('ملف النسخة الاحتياطية غير صالح'); }
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.stages) || !Array.isArray(parsed.attachments) ||
      !parsed.transactions.every(isTransaction) || !parsed.categories.every(isOption) || !parsed.stages.every(isOption) || !parsed.attachments.every(isAttachment)) {
    throw new Error('نسخة احتياطية غير مدعومة');
  }
  const transactionIds = new Set((parsed.transactions as Transaction[]).map((item) => item.id));
  const attachmentIds = new Set<string>();
  const categoryIds = new Set((parsed.categories as NamedOption[]).map((item) => item.id));
  const stageIds = new Set((parsed.stages as NamedOption[]).map((item) => item.id));
  if ((parsed.attachments as BackupAttachment[]).some((item) => {
    if (!transactionIds.has(item.transactionId) || attachmentIds.has(item.id)) return true;
    attachmentIds.add(item.id); return false;
  }) || (parsed.transactions as Transaction[]).some((item) =>
    (item.attachmentId && !(parsed.attachments as BackupAttachment[]).some((attachment) => attachment.id === item.attachmentId)) ||
    (item.categoryId && !categoryIds.has(item.categoryId)) || (item.stageId && !stageIds.has(item.stageId))) ||
    (parsed.transactions as Transaction[]).some((item, index, rows) => rows.findIndex((row) => row.id === item.id) !== index) ||
    (parsed.categories as NamedOption[]).some((item, index, rows) => rows.findIndex((row) => row.id === item.id) !== index) ||
    (parsed.stages as NamedOption[]).some((item, index, rows) => rows.findIndex((row) => row.id === item.id) !== index)) {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }
  return parsed as unknown as BaytiBackup;
}

export function encodeBackup(backup: BaytiBackup): string {
  return JSON.stringify(backup, null, 2);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

export function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
