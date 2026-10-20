import { SaveConfirmationPendingError, TransactionConflictError, type TransactionSaveResult } from './transactionSave';
import type { BaytiBackup } from './backup';
import type { Client, NamedOption, Transaction, TransactionType } from './types';
import type { DashboardCard } from './workspaceFeatures';
import { requireSupabase, protectedFiles } from './supabase';
import type { FontPreferences } from './fonts';

export const CANONICAL_USER_ID = 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6';
export const CANONICAL_PROJECT_ID = '4324284c-2650-4eaa-86bd-152fbd1e8c2e';
type CloudUser = { id: string };

export interface CloudWorkspace { projectId: string; projectName: string; logoUrl: string | null; dashboardOrder: DashboardCard[]; dashboardSize: 'compact' | 'normal' | 'large'; transactions: Transaction[]; trashedTransactions: Transaction[]; clients: Client[]; categories: NamedOption[]; stages: NamedOption[] }
interface TransactionRow {
  id: string; type: TransactionType; amount: number | string; description: string; transaction_date: string;
  category_id: string | null; stage_id: string | null; person_name: string | null; notes: string | null;
  client_id: string | null; deleted_at: string | null; created_at: string; updated_at: string; revision: number;
}
interface OptionRow { id: string; name: string; created_at: string; updated_at: string }
interface AttachmentRow { id: string; transaction_id: string; file_name: string; file_path: string; file_type: string; file_size: number; created_at: string }
interface ClientRow { id: string; name: string; phone: string; profession: string; created_at: string; updated_at: string }
interface ProjectRow { id: string; name: string; logo_path: string | null; settings: { dashboardOrder?: unknown; dashboardSize?: unknown } | null }

const fromIso = (value: string) => new Date(value).getTime();
const toIso = (value: number) => new Date(value).toISOString();
const toTransaction = (row: TransactionRow, attachmentId?: string): Transaction => ({
  id: row.id, revision: row.revision, type: row.type, amount: Number(row.amount), description: row.description, date: row.transaction_date,
  ...(row.category_id ? { categoryId: row.category_id } : {}), ...(row.stage_id ? { stageId: row.stage_id } : {}),
  ...(row.client_id ? { clientId: row.client_id } : {}),
  ...(row.person_name ? { person: row.person_name } : {}), ...(row.notes ? { notes: row.notes } : {}),
  ...(attachmentId ? { attachmentId } : {}), createdAt: fromIso(row.created_at), updatedAt: fromIso(row.updated_at)
});
const toOption = (row: OptionRow): NamedOption => ({ id: row.id, name: row.name, createdAt: fromIso(row.created_at), updatedAt: fromIso(row.updated_at) });

async function checked<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

export async function loadCloudWorkspace(user: CloudUser): Promise<CloudWorkspace> {
  const client = requireSupabase();
  if (user.id !== CANONICAL_USER_ID) throw new Error('الحساب السحابي غير مطابق لمساحة العمل المعتمدة.');
  const projects = await checked(client.from('projects').select('id,name,logo_path,settings').eq('id', CANONICAL_PROJECT_ID).eq('user_id', CANONICAL_USER_ID).limit(1));
  const project = (projects as ProjectRow[])[0];
  const projectId = project?.id;
  if (!project) throw new Error('لم يتم العثور على مساحة بيتي السحابية المعتمدة. تحقق من إعدادات الاتصال أو تواصل مع المسؤول.');
  const [transactionRows, trashedRows, categoryRows, stageRows, attachmentRows, clientRows] = await Promise.all([
    (async () => {
      const all: TransactionRow[] = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await checked(client.from('transactions').select('*').eq('project_id', projectId).is('deleted_at', null).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }).range(offset, offset + 999));
        const rows = page as TransactionRow[];
        all.push(...rows);
        if (rows.length < 1000) return all;
      }
    })(),
    checked(client.from('transactions').select('*').eq('project_id', projectId).not('deleted_at', 'is', null).order('deleted_at', { ascending: false })),
    checked(client.from('categories').select('*').eq('project_id', projectId).order('created_at')),
    checked(client.from('construction_stages').select('*').eq('project_id', projectId).order('created_at')),
    checked(client.from('attachments').select('id,transaction_id').eq('project_id', projectId)),
    checked(client.from('clients').select('*').eq('project_id', projectId).order('name'))
  ]);
  const attachmentByTransaction = new Map((attachmentRows as Pick<AttachmentRow, 'id' | 'transaction_id'>[]).map((row) => [row.transaction_id, row.id]));
  const logoUrl = project.logo_path ? await protectedFiles.read('logo=1') : null;
  const settings = project.settings ?? {};
  return {
    projectId,
    transactions: (transactionRows as TransactionRow[]).map((row) => toTransaction(row, attachmentByTransaction.get(row.id))),
    trashedTransactions: (trashedRows as TransactionRow[]).map((row) => toTransaction(row, attachmentByTransaction.get(row.id))),
    clients: (clientRows as ClientRow[]).map((row) => ({ id: row.id, name: row.name, phone: row.phone, profession: row.profession, createdAt: fromIso(row.created_at), updatedAt: fromIso(row.updated_at) })),
    projectName: project.name,
    logoUrl,
    dashboardOrder: Array.isArray(settings.dashboardOrder) ? settings.dashboardOrder as DashboardCard[] : ['balance', 'income', 'expense'],
    dashboardSize: settings.dashboardSize === 'compact' || settings.dashboardSize === 'large' ? settings.dashboardSize : 'normal',
    categories: (categoryRows as OptionRow[]).map(toOption),
    stages: (stageRows as OptionRow[]).map(toOption)
  };
}

export async function saveCloudTransaction(user: CloudUser, projectId: string, transaction: Transaction, file?: File | null, removeAttachment = false, operationId: string = crypto.randomUUID()): Promise<TransactionSaveResult> {
  const client = requireSupabase();
  if (file && (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size <= 0 || file.size > 10 * 1024 * 1024)) throw new Error('invalid-file');
  type Receipt = { saved: true; cleanup_paths: string[] };
  const finish = async (receipt: Receipt): Promise<TransactionSaveResult> => {
    if (receipt.saved !== true || !Array.isArray(receipt.cleanup_paths)) throw new SaveConfirmationPendingError();
    let cleanupPending = false;
    // Financial commit already succeeded: cleanup must never turn success into failure.
    if (receipt.cleanup_paths.length) {
      try { cleanupPending = Boolean((await client.storage.from('transaction-attachments').remove(receipt.cleanup_paths)).error); }
      catch { cleanupPending = true; }
    }
    return { saved: true, cleanupPending };
  };
  const row = {
    id: transaction.id, user_id: user.id, project_id: projectId, type: transaction.type, amount: transaction.amount,
    transaction_date: transaction.date, description: transaction.description, category_id: transaction.categoryId ?? null,
    stage_id: transaction.stageId ?? null, client_id: transaction.clientId ?? null, person_name: transaction.person ?? null,
    notes: transaction.notes ?? null, created_at: toIso(transaction.createdAt), expected_revision: transaction.revision ?? null
  };
  let attachment: { file_name: string; file_path: string; file_type: string; file_size: number } | null = null;
  if (file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100) || 'attachment';
    const filePath = `${user.id}/${projectId}/${transaction.id}/${operationId}-${hash}-${safeName}`;
    attachment = { file_name: file.name, file_path: filePath, file_type: file.type, file_size: file.size };
  }
  const status = async (): Promise<Receipt | null> => {
    const response = await client.rpc('beity_transaction_save_status', { p_operation_id: operationId, p_transaction: row, p_attachment: attachment, p_remove_attachment: removeAttachment });
    if (response.error) throw new SaveConfirmationPendingError();
    return response.data as Receipt | null;
  };
  const previous = await status();
  if (previous) return finish(previous);
  if (file && attachment) {
    const upload = await client.storage.from('transaction-attachments').upload(attachment.file_path, file, { contentType: file.type, cacheControl: '0', upsert: false });
    // A retry may find its immutable, content-addressed staged object already uploaded.
    if (upload.error && String((upload.error as { statusCode?: unknown }).statusCode) !== '409') throw new Error('attachment-upload-failed');
  }
  try {
    const result = await client.rpc('beity_save_transaction', { p_operation_id: operationId, p_transaction: row, p_attachment: attachment, p_remove_attachment: removeAttachment });
    if (result.error?.code === 'PT409') throw new TransactionConflictError();
    if (result.error) throw result.error;
    return await finish(result.data as Receipt);
  } catch (cause) {
    if (cause instanceof TransactionConflictError) throw cause;
    // A timeout is not proof of rollback. Never delete a file a committed row may reference.
    const receipt = await status();
    if (receipt) return finish(receipt);
    throw new SaveConfirmationPendingError();
  }
}

export async function deleteCloudTransaction(projectId: string, id: string): Promise<void> {
  const client = requireSupabase();
  await checked(client.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('project_id', projectId).is('deleted_at', null));
}

export async function deleteCloudTransactions(projectId: string, ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  const client = requireSupabase();
  await checked(client.from('transactions').update({ deleted_at: new Date().toISOString() }).in('id', uniqueIds).eq('project_id', projectId).is('deleted_at', null));
}

export async function restoreCloudTransaction(projectId: string, id: string): Promise<void> {
  const client = requireSupabase();
  await checked(client.from('transactions').update({ deleted_at: null }).eq('id', id).eq('project_id', projectId).not('deleted_at', 'is', null));
}

export async function permanentlyDeleteCloudTransaction(projectId: string, id: string): Promise<void> {
  const client = requireSupabase();
  const file = await checked(client.from('attachments').select('file_path').eq('transaction_id', id).eq('project_id', projectId).maybeSingle()) as Pick<AttachmentRow, 'file_path'> | null;
  await checked(client.from('transactions').delete().eq('id', id).eq('project_id', projectId).not('deleted_at', 'is', null));
  if (file) {
    const result = await client.storage.from('transaction-attachments').remove([file.file_path]);
    if (result.error) console.error('Attachment cleanup failed', result.error.message);
  }
}

export async function permanentlyDeleteCloudTransactions(projectId: string, ids: string[]): Promise<void> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  const client = requireSupabase();
  const files = await checked(client.from('attachments').select('file_path').eq('project_id', projectId).in('transaction_id', uniqueIds)) as Pick<AttachmentRow, 'file_path'>[];
  await checked(client.from('transactions').delete().eq('project_id', projectId).in('id', uniqueIds).not('deleted_at', 'is', null));
  const filePaths = files.map((file) => file.file_path);
  if (filePaths.length) {
    const result = await client.storage.from('transaction-attachments').remove(filePaths);
    if (result.error) console.error('Attachment cleanup failed', result.error.message);
  }
}

export async function saveCloudClient(user: CloudUser, projectId: string, record: Client): Promise<void> {
  await checked(requireSupabase().from('clients').upsert({ id: record.id, user_id: user.id, project_id: projectId, name: record.name, phone: record.phone, profession: record.profession, created_at: toIso(record.createdAt), updated_at: new Date().toISOString() }));
}

export async function deleteCloudClient(projectId: string, id: string): Promise<void> {
  await checked(requireSupabase().from('clients').delete().eq('id', id).eq('project_id', projectId));
}

export async function saveCloudProjectSettings(projectId: string, name: string, dashboardOrder: DashboardCard[], dashboardSize: 'compact' | 'normal' | 'large'): Promise<void> {
  const client = requireSupabase();
  const project = await checked(client.from('projects').select('settings').eq('id', projectId).maybeSingle()) as { settings: Record<string, unknown> | null } | null;
  await checked(client.from('projects').update({ name: name.trim(), settings: { ...(project?.settings ?? {}), dashboardOrder, dashboardSize } }).eq('id', projectId));
}

export async function uploadCloudLogo(userId: string, projectId: string, file: File): Promise<void> {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size <= 0 || file.size > 2 * 1024 * 1024) throw new Error('logo-invalid');
  const client = requireSupabase();
  const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1];
  // Old signed capabilities must never point at a newly uploaded logo.
  // Keep prior objects intact pending a separately approved retention cleanup.
  const path = `${userId}/${projectId}/logo-${crypto.randomUUID()}.${ext}`;
  const result = await client.storage.from('project-assets').upload(path, file, { contentType: file.type, cacheControl: '0', upsert: false });
  if (result.error) throw new Error(result.error.message);
  try {
    await checked(client.from('projects').update({ logo_path: path }).eq('id', projectId));
  } catch { /* a lost response does not prove rollback */ }
  // Verify even a successful minimal UPDATE: RLS can make it affect zero rows.
  try {
    const confirmed = await checked(client.from('projects').select('logo_path').eq('id', projectId).maybeSingle()) as { logo_path: string | null } | null;
    if (confirmed?.logo_path === path) return;
  } catch { /* retain staged bytes while the outcome is unknown */ }
  throw new SaveConfirmationPendingError();
}

export async function deleteCloudLogo(projectId: string): Promise<void> {
  const client = requireSupabase();
  const project = await checked(client.from('projects').select('logo_path').eq('id', projectId).maybeSingle()) as { logo_path: string | null } | null;
  await checked(client.from('projects').update({ logo_path: null }).eq('id', projectId));
  if (project?.logo_path) await client.storage.from('project-assets').remove([project.logo_path]);
}

export async function getCloudAttachment(transactionId: string): Promise<{ url: string; fileName: string; fileType: string } | null> {
  const client = requireSupabase();
  const row = await checked(client.from('attachments').select('file_path,file_name,file_type').eq('transaction_id', transactionId).maybeSingle()) as Pick<AttachmentRow, 'file_path' | 'file_name' | 'file_type'> | null;
  if (!row) return null;
  return { url: await protectedFiles.read('transaction='+encodeURIComponent(transactionId)), fileName: row.file_name, fileType: row.file_type };
}

export async function saveCloudOption(user: CloudUser, projectId: string, kind: 'category' | 'stage', option: NamedOption): Promise<void> {
  const client = requireSupabase();
  const table = kind === 'category' ? 'categories' : 'construction_stages';
  await checked(client.from(table).upsert({ id: option.id, user_id: user.id, project_id: projectId, name: option.name, created_at: toIso(option.createdAt), updated_at: new Date().toISOString() }));
}

export async function deleteCloudOption(projectId: string, kind: 'category' | 'stage', id: string): Promise<void> {
  const client = requireSupabase();
  const table = kind === 'category' ? 'categories' : 'construction_stages';
  await checked(client.from(table).delete().eq('id', id).eq('project_id', projectId));
}

export async function loadFontPreferences(userId: string): Promise<unknown> {
  const client = requireSupabase();
  const row = await checked(client.from('profiles').select('font_preferences').eq('user_id', userId).maybeSingle()) as { font_preferences: unknown } | null;
  return row?.font_preferences;
}

export async function saveFontPreferences(userId: string, preferences: FontPreferences): Promise<void> {
  const client = requireSupabase();
  await checked(client.from('profiles').update({ font_preferences: preferences }).eq('user_id', userId));
}

export async function importLocalBackup(user: CloudUser, projectId: string, backup: BaytiBackup): Promise<void> {
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
  for (const attachment of backup.attachments) {
    if (!allowedTypes.has(attachment.fileType) || atob(attachment.data).length > 10 * 1024 * 1024) {
      throw new Error(`المرفق «${attachment.fileName}» نوعه غير مدعوم أو حجمه يتجاوز 10 ميغابايت. بقيت البيانات المحلية محفوظة.`);
    }
  }
  const client = requireSupabase();
  const [remoteCategories, remoteStages] = await Promise.all([
    checked(client.from('categories').select('*').eq('project_id', projectId)),
    checked(client.from('construction_stages').select('*').eq('project_id', projectId))
  ]);
  const remapOptions = async (local: NamedOption[], remote: OptionRow[], kind: 'category' | 'stage') => {
    const ids = new Map<string, string>();
    for (const option of local) {
      const existing = (remote as OptionRow[]).find((item) => item.name === option.name);
      if (existing) ids.set(option.id, existing.id);
      else { await saveCloudOption(user, projectId, kind, option); ids.set(option.id, option.id); }
    }
    return ids;
  };
  const categoryIds = await remapOptions(backup.categories, remoteCategories as OptionRow[], 'category');
  const stageIds = await remapOptions(backup.stages, remoteStages as OptionRow[], 'stage');
  for (const transaction of backup.transactions) {
    const { attachmentId, ...record } = transaction;
    const mapped: Transaction = {
      ...record,
      ...(record.categoryId ? { categoryId: categoryIds.get(record.categoryId) ?? record.categoryId } : {}),
      ...(record.stageId ? { stageId: stageIds.get(record.stageId) ?? record.stageId } : {})
    };
    const source = backup.attachments.find((item) => item.id === attachmentId);
    if (!source) { await saveCloudTransaction(user, projectId, mapped, null, true); continue; }
    const decoded = atob(source.data);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    const file = new File([bytes], source.fileName, { type: source.fileType });
    await saveCloudTransaction(user, projectId, mapped, file);
  }
}
