import { describe, expect, it } from 'vitest';
import { decodeBackup, encodeBackup, type BaytiBackup } from './backup';

const fixture: BaytiBackup = {
  version: 1,
  exportedAt: '2026-10-07T00:00:00.000Z',
  transactions: [{ id: 'tx-1', type: 'expense', amount: 12.5, description: 'فاتورة ١٢', date: '2026-10-01', createdAt: 1, updatedAt: 2, attachmentId: 'att-1' }],
  categories: [{ id: 'cat-1', name: 'مواد', createdAt: 1, updatedAt: 1 }],
  stages: [{ id: 'stage-1', name: 'الأساس', createdAt: 1, updatedAt: 1 }],
  attachments: [{ id: 'att-1', transactionId: 'tx-1', fileName: 'وصل.png', fileType: 'image/png', data: 'aGVsbG8=', createdAt: 3 }]
};

describe('Bayti backup format', () => {
  it('round trips the full backup including attachment data', () => {
    expect(decodeBackup(encodeBackup(fixture))).toEqual(fixture);
  });

  it('rejects unsupported or malformed backup files', () => {
    expect(() => decodeBackup('{"version":99}')).toThrow('نسخة احتياطية غير مدعومة');
    expect(() => decodeBackup('{')).toThrow('ملف النسخة الاحتياطية غير صالح');
    expect(() => decodeBackup('{"version":1,"transactions":[null],"categories":[],"stages":[],"attachments":[]}')).toThrow('نسخة احتياطية غير مدعومة');
  });
});
