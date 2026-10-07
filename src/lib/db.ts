import Dexie, { type EntityTable } from 'dexie';
import type { NamedOption, StoredAttachment, Transaction } from './types';
import { blobToBase64, type BaytiBackup } from './backup';

class BaytiDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>;
  categories!: EntityTable<NamedOption, 'id'>;
  stages!: EntityTable<NamedOption, 'id'>;
  attachments!: EntityTable<StoredAttachment, 'id'>;

  constructor() {
    super('bayti-house-tracker');
    this.version(2).stores({
      transactions: 'id, type, date, categoryId, stageId, person, createdAt',
      categories: 'id, name, createdAt',
      stages: 'id, name, createdAt',
      attachments: 'id, transactionId'
    });
  }
}

export const db = new BaytiDatabase();

const categoryNames = ['مواد بناء', 'إسمنت', 'حديد', 'طابوق', 'رمل وحصى', 'أجور عمال', 'كهرباء', 'سباكة', 'أبواب وشبابيك', 'نقل', 'تشطيبات', 'أخرى'];
const stageNames = ['الأساس', 'الهيكل والبناء', 'السقف', 'الكهرباء', 'السباكة', 'الأبواب والشبابيك', 'التبليط', 'الصبغ', 'التشطيبات', 'أخرى'];

export async function seedOptions(): Promise<void> {
  const now = Date.now();
  await db.transaction('rw', db.categories, db.stages, async () => {
    if ((await db.categories.count()) === 0) {
      await db.categories.bulkAdd(categoryNames.map((name, index) => ({ id: crypto.randomUUID(), name, createdAt: now + index, updatedAt: now + index })));
    }
    if ((await db.stages.count()) === 0) {
      await db.stages.bulkAdd(stageNames.map((name, index) => ({ id: crypto.randomUUID(), name, createdAt: now + index, updatedAt: now + index })));
    }
  });
}

export async function saveTransaction(record: Transaction, file?: File | null, removeAttachment = false): Promise<void> {
  await db.transaction('rw', db.transactions, db.attachments, async () => {
    const previous = await db.transactions.get(record.id);
    const next = { ...record, createdAt: previous?.createdAt ?? record.createdAt, updatedAt: Date.now() };
    if (file) {
      if (previous?.attachmentId) await db.attachments.delete(previous.attachmentId);
      const attachmentId = crypto.randomUUID();
      await db.attachments.add({ id: attachmentId, transactionId: record.id, fileName: file.name, fileType: file.type, blob: file, createdAt: Date.now() });
      next.attachmentId = attachmentId;
    } else if (removeAttachment && previous?.attachmentId) {
      await db.attachments.delete(previous.attachmentId);
      delete next.attachmentId;
    } else if (previous?.attachmentId) {
      next.attachmentId = previous.attachmentId;
    }
    await db.transactions.put(next);
  });
}

export async function deleteTransaction(id: string): Promise<void> {
  await db.transaction('rw', db.transactions, db.attachments, async () => {
    const record = await db.transactions.get(id);
    if (record?.attachmentId) await db.attachments.delete(record.attachmentId);
    await db.transactions.delete(id);
  });
}

export async function createLocalBackup(): Promise<BaytiBackup> {
  const [transactions, categories, stages, attachments] = await Promise.all([
    db.transactions.toArray(), db.categories.toArray(), db.stages.toArray(), db.attachments.toArray()
  ]);
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    transactions,
    categories,
    stages,
    attachments: await Promise.all(attachments.map(async ({ blob, ...attachment }) => ({ ...attachment, data: await blobToBase64(blob) })))
  };
}
