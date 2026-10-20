import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ rows: new Map<string, unknown>(), receipts: new Map<string, unknown>(), files: new Set<string>(), projectLogoPath: null as string | null, ignoreLogoUpdate:false,failLogoUpdate:false,lostLogoReply:false,lastUploadPath: '', lastUpsert: undefined as boolean | undefined, uploadCacheControl: undefined as string | undefined, conflict: false, failUpload: false, failTransaction: false, failMetadata: false, lostReply: false, failCleanup: false, statusUnavailable: false, loseConfirmation: false }));
vi.mock('./supabase', () => ({ requireSupabase: () => ({
  from(_table: string) { return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: _table==='projects'?{logo_path:fixture.projectLogoPath}:null, error: null }) }) }),
    upsert: async (row: { id: string }) => { fixture.rows.set(row.id, row); return { data: null, error: null }; },
    update:(row:{logo_path?:string})=>({eq:async()=>{if(!fixture.failLogoUpdate&&!fixture.ignoreLogoUpdate&&row.logo_path)fixture.projectLogoPath=row.logo_path;return {data:null,error:fixture.failLogoUpdate||fixture.lostLogoReply?{message:'isolated reply failure'}:null};}}),
    insert: async () => ({ data: null, error: fixture.failMetadata ? { message: 'metadata failure' } : null }) }; },
  async rpc(name: string, args: Record<string, unknown>) {
    const id = args.p_operation_id as string;
    if (name === 'beity_transaction_save_status') return fixture.statusUnavailable ? { data: null, error: { message: 'offline' } } : { data: fixture.receipts.get(id) ?? null, error: null };
    const row = args.p_transaction as { id: string };
    if (fixture.receipts.has(id)) return { data: fixture.receipts.get(id), error: null };
    if(fixture.conflict)return {data:null,error:{code:'PT409',message:'transaction revision conflict'}};
    if (fixture.failTransaction || fixture.failMetadata) return { data: null, error: { message: 'atomic save rejected' } };
    fixture.rows.set(row.id, row);
    const result = { saved: true, cleanup_paths: ['/old-file'] };
    fixture.receipts.set(id, result);
    if (fixture.lostReply) { if (fixture.loseConfirmation) fixture.statusUnavailable = true; return { data: null, error: { message: 'reply lost' } }; }
    return { data: result, error: null };
  },
  storage: { from: () => ({ upload: async (path: string, _file: File, options: {cacheControl?:string;upsert?:boolean}) => {
    fixture.uploadCacheControl=options.cacheControl;fixture.lastUploadPath=path;fixture.lastUpsert=options.upsert;
    if (fixture.failUpload) return { error: { message: 'upload failed' } };
    if (fixture.files.has(path)) return { error: { statusCode: '409', message: 'exists' } };
    fixture.files.add(path); return { error: null };
  }, remove: async (paths: string[]) => {
    if (fixture.failCleanup) return { error: { message: 'cleanup failed' } };
    paths.forEach((path) => fixture.files.delete(path)); return { error: null };
  } }) }
}) }));
import { saveCloudTransaction, uploadCloudLogo } from './cloudData';
const user = { id: 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6' };
const project = '4324284c-2650-4eaa-86bd-152fbd1e8c2e';
const record = { id: '12345678-1111-4111-8111-123456789012', type: 'expense' as const, amount: 175000, description: 'test only', date: '2026-10-18', createdAt: 1, updatedAt: 1 };
const file = () => new File(['isolated fixture'], 'sample.pdf', { type: 'application/pdf' });
beforeEach(() => { fixture.rows.clear(); fixture.receipts.clear(); fixture.files.clear(); fixture.projectLogoPath=null;fixture.ignoreLogoUpdate=fixture.failLogoUpdate=fixture.lostLogoReply=false;fixture.conflict = fixture.failUpload = fixture.failTransaction = fixture.failMetadata = fixture.lostReply = fixture.failCleanup = fixture.statusUnavailable = fixture.loseConfirmation = false; });
describe('cloud save consistency', () => {
  it('does not commit money when attachment metadata fails', async () => {
    fixture.failMetadata = true;
    await expect(saveCloudTransaction(user, project, record, file())).rejects.toBeDefined();
    expect(fixture.rows.size).toBe(0);
  });
  it('does not commit money when upload fails', async () => {
    fixture.failUpload = true;
    await expect(saveCloudTransaction(user, project, record, file())).rejects.toBeDefined();
    expect(fixture.rows.size).toBe(0);
  });
  it('does not commit when PostgreSQL rejects the transaction', async () => {
    fixture.failTransaction = true;
    await expect(saveCloudTransaction(user, project, record, file())).rejects.toBeDefined();
    expect(fixture.rows.size).toBe(0);
  });
  it('recovers a committed save after the network loses its reply', async () => {
    fixture.lostReply = true;
    await saveCloudTransaction(user, project, record, file());
    expect(fixture.rows.size).toBe(1);
    expect(fixture.receipts.size).toBe(1);
  });
  it('reports success even when old storage cleanup fails', async () => {
    fixture.failCleanup = true;
    const result = await saveCloudTransaction(user, project, record, file());
    expect(result).toMatchObject({ saved: true, cleanupPending: true });
    expect(fixture.rows.size).toBe(1);
  });
});

it('reuses one staged object and one financial ID after a rejected save is retried', async () => {
  const operation = crypto.randomUUID(); const attachment = file();
  fixture.failMetadata = true;
  await expect(saveCloudTransaction(user, project, record, attachment, false, operation)).rejects.toThrow('save-confirmation-pending');
  expect(fixture.rows.size).toBe(0); expect(fixture.files.size).toBe(1);
  fixture.failMetadata = false;
  await saveCloudTransaction(user, project, record, attachment, false, operation);
  expect(fixture.files.size).toBe(1); expect(fixture.rows.size).toBe(1); expect(fixture.receipts.size).toBe(1);
});
it('never deletes a possibly committed attachment when both reply and confirmation are lost', async () => {
  const operation = crypto.randomUUID();
  fixture.lostReply = true;
  fixture.loseConfirmation = true;
  const attachment = file();
  await expect(saveCloudTransaction(user, project, record, attachment, false, operation)).rejects.toThrow('save-confirmation-pending');
  expect(fixture.rows.size).toBe(1); expect(fixture.files.size).toBe(1);
  fixture.statusUnavailable = false; fixture.lostReply = false;
  await saveCloudTransaction(user, project, record, attachment, false, operation);
  expect(fixture.rows.size).toBe(1); expect(fixture.receipts.size).toBe(1); expect(fixture.files.size).toBe(1);
});

it('reports an authoritative stale edit conflict separately from an unknown save outcome',async()=>{
 fixture.conflict=true;
 await expect(saveCloudTransaction(user,project,{...record,revision:0})).rejects.toThrow('transaction-conflict');
 expect(fixture.rows.size).toBe(0);expect(fixture.receipts.size).toBe(0);
});

it('uploads new attachments with zero cache lifetime rather than extending detached URL exposure',async()=>{
 await saveCloudTransaction(user,project,record,file());expect(fixture.uploadCacheControl).toBe('0');
});

it('uses zero cache lifetime for new project logos too',async()=>{
 await uploadCloudLogo(user.id,project,new File(['synthetic'],'logo.png',{type:'image/png'}));expect(fixture.uploadCacheControl).toBe('0');
});

it('never overwrites the stable historical logo key when a new logo is uploaded',async()=>{
 await uploadCloudLogo(user.id,project,new File(['synthetic'],'logo.png',{type:'image/png'}));
 expect(fixture.lastUploadPath).not.toBe(`${user.id}/${project}/logo.png`);expect(fixture.lastUpsert).toBe(false);
});

it('recovers a saved logo path when the project-update reply is lost',async()=>{
 fixture.lostLogoReply=true;
 await expect(uploadCloudLogo(user.id,project,new File(['synthetic'],'logo.png',{type:'image/png'}))).resolves.toBeUndefined();
 expect(fixture.projectLogoPath).toBe(fixture.lastUploadPath);
});
it('retains the previous logo when the new project pointer cannot be committed',async()=>{
 const previous=`${user.id}/${project}/logo.png`;fixture.projectLogoPath=previous;fixture.files.add(previous);fixture.failLogoUpdate=true;
 await expect(uploadCloudLogo(user.id,project,new File(['synthetic'],'logo.png',{type:'image/png'}))).rejects.toThrow();
 expect(fixture.projectLogoPath).toBe(previous);expect(fixture.lastUploadPath).not.toBe(previous);expect(fixture.files.has(previous)).toBe(true);
});

it('does not claim logo success when RLS makes the pointer update affect zero rows',async()=>{
 fixture.ignoreLogoUpdate=true;
 await expect(uploadCloudLogo(user.id,project,new File(['synthetic'],'logo.png',{type:'image/png'}))).rejects.toThrow('save-confirmation-pending');
 expect(fixture.projectLogoPath).toBeNull();
});
