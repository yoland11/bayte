import { beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const database = process.env.BEITY_TEST_DATABASE_URL;
if (database) {
  const url = new URL(database);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !/^\/beity_test_[a-z0-9_]+$/.test(url.pathname)) throw new Error('Integration tests require an explicitly named isolated loopback database');
}
const sql = async (query: string) => (await exec('psql', [database!, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query])).stdout.trim();
const user = 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6';
const project = '4324284c-2650-4eaa-86bd-152fbd1e8c2e';
const session = '00000000-0000-4000-8000-000000000001';
const claims = `set role authenticated; set request.jwt.claims='{"sub":"${user}","session_id":"${session}","role":"authenticated"}';`;
const tx = (id = '00000000-0000-4000-8000-000000000002') => ({ id, user_id: user, project_id: project, type: 'expense', amount: 175000, transaction_date: '2026-10-18', description: 'isolated fixture', created_at: '2026-10-18T00:00:00Z' });
const save = (operation: string, attachment: unknown = null, record = tx()) => `select public.beity_save_transaction('${operation}', '${JSON.stringify(record)}'::jsonb, '${JSON.stringify(attachment)}'::jsonb, false);`;
describe.skipIf(!database)('isolated PostgreSQL security integration', () => {
  beforeAll(async () => {
    await sql(`truncate public.transaction_save_operations, public.attachments, public.transactions, public.beity_pin_attempt_windows, auth.sessions, storage.objects; grant select,insert,update,delete on all tables in schema public,storage to authenticated; revoke all on public.beity_runtime_controls,public.beity_pin_attempt_windows,public.beity_pin_rate_limits from authenticated; grant usage on schema auth,storage to authenticated; insert into auth.users(id) values('${user}') on conflict do nothing; insert into auth.sessions(id,user_id) values('${session}','${user}') on conflict do nothing; insert into public.projects(id,user_id,name) values('${project}','${user}','isolated fixture') on conflict do nothing;`);
  });
  it('never auto-creates a new financial workspace when an Auth account is inserted',async()=>{
    const before=await sql('select count(*) from public.projects'),testUser=crypto.randomUUID();
    await sql(`insert into auth.users(id) values('${testUser}')`);
    expect(await sql('select count(*) from public.projects')).toBe(before);
    expect(await sql(`select count(*) from public.profiles where user_id='${testUser}'`)).toBe('0');
  });
  it('reserves only five of 24 simultaneous requests from one IP in real PostgreSQL', async () => {
    const hash = 'a'.repeat(64);
    const results = await Promise.all(Array.from({ length: 24 }, () => sql(`select public.beity_reserve_pin_attempt('${hash}','${'b'.repeat(64)}');`)));
    expect(results.filter((x) => x === 't')).toHaveLength(5);
  });
  it('does not lock an unrelated network after those failures', async () => {
    expect(await sql(`select public.beity_reserve_pin_attempt('${'c'.repeat(64)}','${'d'.repeat(64)}');`)).toBe('t');
  });
  it('rolls back money and receipt if attachment metadata fails', async () => {
    const operation = '00000000-0000-4000-8000-000000000003';
    const path = `${user}/${project}/${tx().id}/${operation}-fixture.pdf`;
    await sql(`insert into storage.objects(bucket_id,name,metadata) values('transaction-attachments','${path}','{"size":2,"mimetype":"application/pdf"}');`);
    // Valid staged upload, but invalid metadata after the financial INSERT must roll back BOTH.
    await expect(sql(claims + save(operation, { file_path: path, file_name: null, file_type: 'application/pdf', file_size: 2 }))).rejects.toThrow();
    expect(await sql(`select count(*) from transactions where id='${tx().id}'`)).toBe('0');
    expect(await sql(`select count(*) from transaction_save_operations`)).toBe('0');
  });
  it('replays one operation concurrently without duplicating financial rows', async () => {
    const replies = await Promise.all(Array.from({ length: 12 }, () => sql(claims + save('00000000-0000-4000-8000-000000000004'))));
    expect(replies.every((x) => JSON.parse(x).saved === true)).toBe(true);
    expect(await sql(`select count(*) from transactions where id='${tx().id}'`)).toBe('1');
    expect(await sql(`select sum(amount) from transactions where id='${tx().id}'`)).toBe('175000.00');
  });
  it('rejects PostgreSQL NaN amounts and rolls back the save receipt',async()=>{
    const id=crypto.randomUUID(),op=crypto.randomUUID();
    await expect(sql(claims+save(op,null,{...tx(id),amount:'NaN'}))).rejects.toThrow();
    expect(await sql(`select count(*) from transactions where id='${id}'`)).toBe('0');
    expect(await sql(`select count(*) from transaction_save_operations where operation_id='${op}'`)).toBe('0');
  });
  it('rejects changing the payload while reusing a committed idempotency key', async () => {
    await expect(sql(claims + save('00000000-0000-4000-8000-000000000004', null, { ...tx(), amount: 999 }))).rejects.toThrow();
    expect(await sql(`select amount from transactions where id='${tx().id}'`)).toBe('175000.00');
  });
  it('rejects a foreign owner and prevents leaking save receipts', async () => {
    const other = `set role authenticated; set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000099","session_id":"${session}"}';`;
    expect(await sql(other + `select public.beity_transaction_save_status('00000000-0000-4000-8000-000000000004') is null;`)).toBe('t');
    await expect(sql(other + save('00000000-0000-4000-8000-000000000005'))).rejects.toThrow();
  });
  it('rolls back receipts and attachments when the financial row is invalid', async () => {
    await expect(sql(claims + save('00000000-0000-4000-8000-000000000011', null, { ...tx('00000000-0000-4000-8000-000000000012'), amount: -1 }))).rejects.toThrow();
    expect(await sql("select count(*) from transaction_save_operations where operation_id='00000000-0000-4000-8000-000000000011';")).toBe('0');
  });
  it('commits a staged attachment and financial row together and replays them once', async () => {
    const operation = '00000000-0000-4000-8000-000000000021';
    const record = tx('00000000-0000-4000-8000-000000000022');
    const path = `${user}/${project}/${record.id}/${operation}-fixture.pdf`;
    await sql(`insert into storage.objects(bucket_id,name,metadata) values('transaction-attachments','${path}','{"size":2,"mimetype":"application/pdf"}');`);
    const attachment = { file_path: path, file_name: 'sample.pdf', file_type: 'application/pdf', file_size: 2 };
    const replies = await Promise.all(Array.from({length: 8}, () => sql(claims + save(operation, attachment, record))));
    expect(replies.every((reply) => JSON.parse(reply).saved)).toBe(true);
    expect(await sql(`select count(*) from attachments where transaction_id='${record.id}'`)).toBe('1');
    expect(await sql(`select count(*) from transactions where id='${record.id}'`)).toBe('1');
  });
  it('does not overwrite a newer edit when an older committed save is retried', async () => {
    const record = tx('00000000-0000-4000-8000-000000000032');
    await sql(claims + save('00000000-0000-4000-8000-000000000031', null, record));
    await sql(claims + save('00000000-0000-4000-8000-000000000033', null, { ...record, amount: 275000, expected_revision: 0 }));
    await sql(claims + save('00000000-0000-4000-8000-000000000031', null, record));
    expect(await sql(`select amount from transactions where id='${record.id}'`)).toBe('275000.00');
  });
  it('rejects a stale concurrent financial edit instead of overwriting a newer amount',async()=>{
    const record=tx('00000000-0000-4000-8000-000000000092');
    await sql(claims+save('00000000-0000-4000-8000-000000000091',null,record));
    const results=await Promise.allSettled([
      sql(claims+save('00000000-0000-4000-8000-000000000093',null,{...record,amount:275000,expected_revision:0})),
      sql(claims+save('00000000-0000-4000-8000-000000000094',null,{...record,amount:375000,expected_revision:0}))
    ]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect(await sql(`select count(*) from transaction_save_operations where operation_id in ('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000094')`)).toBe('1');
  });
  it('refuses an update with no expected revision',async()=>{
    const record=tx('00000000-0000-4000-8000-000000000096');
    await sql(claims+save('00000000-0000-4000-8000-000000000095',null,record));
    await expect(sql(claims+save('00000000-0000-4000-8000-000000000097',null,{...record,amount:999}))).rejects.toThrow();
    expect(await sql(`select amount from transactions where id='${record.id}'`)).toBe('175000.00');
  });
  it('does not grant the browser access to the server-only limiter', async () => {
    await expect(sql(claims + `select public.beity_reserve_pin_attempt('${'e'.repeat(64)}','${'f'.repeat(64)}');`)).rejects.toThrow();
  });
  it('denies a revoked JWT for reads and writes while another device remains valid', async () => {
    const otherSession = '00000000-0000-4000-8000-000000000009';
    await sql(`insert into auth.sessions values('${otherSession}','${user}') on conflict do nothing; delete from auth.sessions where id='${session}';`);
    for (const table of ['profiles','projects','transactions','clients','categories','construction_stages','attachments','transaction_save_operations']) {
      expect(await sql(claims + `select count(*) from public.${table};`)).toBe('0');
    }
    expect(await sql(claims + 'select count(*) from storage.objects;')).toBe('0');
    await expect(sql(claims + save('00000000-0000-4000-8000-000000000006'))).rejects.toThrow();
    const otherClaims = claims.replace(session, otherSession);
    expect(await sql(otherClaims + `select count(*) from transactions where id='${tx().id}';`)).toBe('1');
    await sql(`insert into auth.sessions values('${session}','${user}');`);
  });
  it('blocks an already authenticated financial writer during maintenance', async () => {
    await sql('update public.beity_runtime_controls set maintenance=true where id;');
    try {
      await expect(sql(claims + save('00000000-0000-4000-8000-000000000071', null, tx('00000000-0000-4000-8000-000000000072')))).rejects.toThrow();
      expect(await sql(claims + `with changed as (update public.transactions set amount=999 where id='${tx().id}' returning id) select count(*) from changed;`)).toBe('0');
      await expect(sql(claims + 'update public.beity_runtime_controls set maintenance=false;')).rejects.toThrow();
    } finally { await sql('update public.beity_runtime_controls set maintenance=false where id;'); }
  });
  it('restores normal saving after an operator ends maintenance',async()=>{
    await sql(claims + save('00000000-0000-4000-8000-000000000081',null,tx('00000000-0000-4000-8000-000000000082')));
    expect(await sql(`select amount from public.transactions where id='00000000-0000-4000-8000-000000000082';`)).toBe('175000.00');
  });

});
