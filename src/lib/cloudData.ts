import type { User } from '@supabase/supabase-js';
import type { BaytiBackup } from './backup';
import type { Client, NamedOption, Transaction, TransactionType } from './types';
import type { DashboardCard } from './workspaceFeatures';
import { requireSupabase } from './supabase';
import type { FontPreferences } from './fonts';

export interface CloudWorkspace { projectId: string; projectName: string; logoUrl: string | null; dashboardOrder: DashboardCard[]; dashboardSize: 'compact' | 'normal' | 'large'; transactions: Transaction[]; trashedTransactions: Transaction[]; clients: Client[]; categories: NamedOption[]; stages: NamedOption[] }
interface TransactionRow {
  id: string; type: TransactionType; amount: number | string; description: string; transaction_date: string;
  category_id: string | null; stage_id: string | null; person_name: string | null; notes: string | null;
  client_id: string | null; deleted_at: string | null; created_at: string; updated_at: string;
}
interface OptionRow { id: string; name: string; created_at: string; updated_at: string }
interface AttachmentRow { id: string; transaction_id: string; file_name: string; file_path: string; file_type: string; file_size: number; created_at: string }
interface ClientRow { id: string; name: string; phone: string; profession: string; created_at: string; updated_at: string }
interface ProjectRow { id: string; name: string; logo_path: string | null; settings: { dashboardOrder?: unknown; dashboardSize?: unknown } | null }

const fromIso = (value: string) => new Date(value).getTime();
const toIso = (value: number) => new Date(value).toISOString();
const toTransaction = (row: TransactionRow, attachmentId?: string): Transaction => ({
  id: row.id, type: row.type, amount: Number(row.amount), description: row.description, date: row.transaction_date,
  ...(row.category_id ? { categoryId: row.category_id } : {}), ...(row.stage_id ? { stageId: row.stage_id } : {}),
  ...(row.client_id ? { clientId: row.client_id } : {}),
  ...(row.person_name ? { person: row.person_name } : {}), ...(row.notes ? { notes: row.notes } : {}),
  ...(attachmentId ? { attachmentId } : {}), createdAt: fromIso(row.created_at), updatedAt: fromIso(row.updated_at)
});
const toOption = (row: OptionRow): NamedOption => ({ id: row.id, name: row.name, createdAt: fromIso(row.created_at), updatedAt: fromIso(row.updated_at) });

async function checked<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

export async function loadCloudWorkspace(user: User): Promise<CloudWorkspace> {
  const client = requireSupabase();
  const projects = await checked(client.from('projects').select('id,name,logo_path,settings').eq('user_id', user.id).order('created_at').limit(1));
  const project = (projects as ProjectRow[])[0];
  const projectId = project?.id;
  if (!project) throw new Error('لم يتم إنشاء مشروع الحساب. راجع إعداد قاعدة البيانات أو تواصل مع المسؤول.');
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
  const logoUrl = project.logo_path ? await client.storage.from('project-assets').createSignedUrl(project.logo_path, 60 * 60).then(({ data, error }) => { if (error) throw new Error(error.message); return data.signedUrl; }) : null;
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

export async function saveCloudTransaction(user: User, projectId: string, transaction: Transaction, file?: File | null, removeAttachment = false): Promise<void> {
  const client = requireSupabase();
  const existing = await checked(client.from('attachments').select('*').eq('transaction_id', transaction.id).maybeSingle()) as AttachmentRow | null;
  const now = new Date().toISOString();
  const row = {
    id: transaction.id, user_id: user.id, project_id: projectId, type: transaction.type, amount: transaction.amount,
    transaction_date: transaction.date, description: transaction.description, category_id: transaction.categoryId ?? null,
    stage_id: transaction.stageId ?? null, client_id: transaction.clientId ?? null, person_name: transaction.person ?? null, notes: transaction.notes ?? null,
    created_at: toIso(transaction.createdAt), updated_at: now
  };
  let uploadedPath: string | null = null;
  let attachmentId = '';
  if (file) {
    attachmentId = crypto.randomUUID();
    const safeName = file.name.replace(/[^\p{L}\p{N}._-]/gu, '_').slice(-100) || 'attachment';
    const filePath = `${user.id}/${projectId}/${transaction.id}/${attachmentId}-${safeName}`;
    const upload = await client.storage.from('transaction-attachments').upload(filePath, file, { contentType: file.type, upsert: false });
    if (upload.error) throw new Error(upload.error.message);
    uploadedPath = filePath;
  }
  try {
    await checked(client.from('transactions').upsert(row));
    if (file && uploadedPath) {
      const metadata = { user_id: user.id, project_id: projectId, transaction_id: transaction.id, file_name: file.name, file_path: uploadedPath, file_type: file.type, file_size: file.size };
      if (existing) await checked(client.from('attachments').update(metadata).eq('id', existing.id));
      else await checked(client.from('attachments').insert({ id: attachmentId, ...metadata }));
    } else if (removeAttachment && existing) {
      await checked(client.from('attachments').delete().eq('id', existing.id));
      await client.storage.from('transaction-attachments').remove([existing.file_path]);
    }
  } catch (error) {
    if (uploadedPath) await client.storage.from('transaction-attachments').remove([uploadedPath]);
    throw error;
  }
  if (file && existing) {
    const removeResult = await client.storage.from('transaction-attachments').remove([existing.file_path]);
    if (removeResult.error) console.error('Old attachment cleanup failed', removeResult.error.message);
  }
}

export async function deleteCloudTransaction(projectId: string, id: string): Promise<void> {
  const client = requireSupabase();
  await checked(client.from('transactions').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('project_id', projectId).is('deleted_at', null));
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

export async function saveCloudClient(user: User, projectId: string, record: Client): Promise<void> {
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
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('logo-invalid');
  const client = requireSupabase();
  const project = await checked(client.from('projects').select('logo_path').eq('id', projectId).maybeSingle()) as { logo_path: string | null } | null;
  const ext = file.type === 'image/svg+xml' ? 'svg' : file.type.split('/')[1];
  const path = `${userId}/${projectId}/logo.${ext}`;
  const result = await client.storage.from('project-assets').upload(path, file, { contentType: file.type, upsert: true });
  if (result.error) throw new Error(result.error.message);
  await checked(client.from('projects').update({ logo_path: path }).eq('id', projectId));
  if (project?.logo_path && project.logo_path !== path) await client.storage.from('project-assets').remove([project.logo_path]);
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
  const result = await client.storage.from('transaction-attachments').createSignedUrl(row.file_path, 60 * 10);
  if (result.error) throw new Error(result.error.message);
  return { url: result.data.signedUrl, fileName: row.file_name, fileType: row.file_type };
}

export async function saveCloudOption(user: User, projectId: string, kind: 'category' | 'stage', option: NamedOption): Promise<void> {
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

export async function importLocalBackup(user: User, projectId: string, backup: BaytiBackup): Promise<void> {
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
    await saveCloudTransaction(user, projectId, mapped, null, true);
    const source = backup.attachments.find((item) => item.id === attachmentId);
    if (!source) continue;
    const decoded = atob(source.data);
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
    const file = new File([bytes], source.fileName, { type: source.fileType });
    await saveCloudTransaction(user, projectId, mapped, file);
  }
}
