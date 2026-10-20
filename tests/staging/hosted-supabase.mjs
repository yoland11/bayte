// Explicit opt-in runner. Never loads .env.local or a production project.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import argon2 from '@node-rs/argon2';
const STAGING = 'kwuhkahuhacemmgbgffw';
const configPath = process.env.BEITY_STAGING_CONFIG;
assert(configPath, 'Explicit private staging configuration required');
const c = JSON.parse(readFileSync(configPath, 'utf8'));
assert.equal(c.projectRef, STAGING);
assert.equal(c.url, `https://${STAGING}.supabase.co`);
assert.equal(process.env.BEITY_ALLOW_STAGING_WRITES, STAGING);
const owner = 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6';
const workspace = '4324284c-2650-4eaa-86bd-152fbd1e8c2e';
const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(c.url, c.serviceKey, opts);
const anonymous = createClient(c.url, c.publicKey, opts);
const must = (r, label) => { assert(!r.error, `${label}: ${r.error?.code || r.error?.status || 'error'}`); return r.data; };
const evidencePath=process.env.BEITY_STAGING_EVIDENCE||'docs/staging-verification-latest.json';
const evidence = { date: new Date().toISOString(), stagingRef: STAGING, syntheticDataOnly: true, checks: [] };
async function check(name, fn) {
  try { await fn(); evidence.checks.push({ name, result: 'PASS' }); console.log('PASS:', name); }
  catch (error) {
    evidence.checks.push({ name, result: 'FAIL' }); console.log('FAIL:', name);
    let detail = String(error?.stack || error);
    for (const value of [c.serviceKey,c.publicKey,c.password,c.pin,c.rateSecret,process.env.BEITY_PIN_ARGON2_HASH]) if(value) detail=detail.replaceAll(value,'<redacted>');
    writeFileSync(resolve(configPath,'../failure-'+evidence.checks.length+'.log'),detail,{mode:0o600});
  }
  finally { writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n'); }
}
// Staging only: create synthetic GoTrue user with the code's canonical fixture UUID.
const current = await admin.auth.admin.getUserById(owner);
if (!current.data.user) {
  const response = await fetch(`${c.url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: c.serviceKey, Authorization: `Bearer ${c.serviceKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ id: owner, email: c.email, password: c.password, email_confirm: true }) });
  assert.equal(response.status, 200, 'Synthetic canonical user creation failed');
  assert.equal((await response.json()).id, owner);
}
assert.equal(must(await admin.auth.admin.getUserById(owner), 'fixture identity').user.id, owner);
// Keep the default bootstrap project untouched; canonical fixture is explicit and reused.
const project = must(await admin.from('projects').select('id').eq('id', workspace), 'fixture lookup');
if (!project.length) must(await admin.from('projects').insert({ id: workspace, user_id: owner, name: 'اختبار بيتي المعزول', description: 'Synthetic staging fixture only' }), 'fixture project');
process.env.SUPABASE_URL = c.url; process.env.VITE_SUPABASE_URL = c.url;
process.env.VERCEL_ENV = 'preview';process.env.VITE_SUPABASE_PUBLISHABLE_KEY=c.publicKey;
process.env.SUPABASE_PUBLISHABLE_KEY = c.publicKey; process.env.SUPABASE_SERVICE_ROLE_KEY = c.serviceKey;
process.env.BEITY_CANONICAL_EMAIL = c.email; process.env.BEITY_CANONICAL_PASSWORD = c.password;
process.env.BEITY_RATE_LIMIT_SECRET = c.rateSecret;
process.env.BEITY_PIN_ARGON2_HASH = await argon2.hash(c.pin, { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 });
const runNetwork = randomBytes(2).toString('hex');
const ip = n => `2001:db8:${runNetwork}:${n}::1`;
const handlers = {};
assert(process.env.BEITY_STAGING_HANDLERS,'Build reviewed current handlers into a private local module first');
const currentHandlers=await import(pathToFileURL(resolve(process.env.BEITY_STAGING_HANDLERS)));
for (const route of ['login', 'session', 'logout']) {handlers[route]=currentHandlers[route];assert.equal(typeof handlers[route],'function');}
const activeBefore=must(await admin.from('transactions').select('id,type,amount').eq('project_id',workspace).is('deleted_at',null).order('id'),'active fixture baseline');
function device(ip) {
  let cookie = '', access = '';
  return {
    get cookie() { return cookie; }, get access() { return access; },
    client() { return createClient(c.url, c.publicKey, { ...opts, global: { headers: { Authorization: `Bearer ${access}` } } }); },
    async call(route, pin, replayCookie, bearer = access) {
      let status = 200, data; const headers = {};
      const res = { status(n) { status = n; return res; }, setHeader(k, v) { headers[k.toLowerCase()] = v; }, json(v) { data = v; }, end() {} };
      await handlers[route]({ method: route === 'session' ? 'GET' : 'POST', headers: { host: 'beity-staging.local', origin: 'https://beity-staging.local', 'x-real-ip': ip, cookie: replayCookie ?? cookie, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) }, body: { pin } }, res);
      if (replayCookie === undefined && headers['set-cookie']) cookie = headers['set-cookie'].split(';')[0];
      if (data?.accessToken) access = data.accessToken;
      return { status, data, headers };
    }
  };
}
const a = device(ip(1)), b = device(ip(2));
await check('real PIN handlers authenticate two independent GoTrue sessions', async () => {
  assert.equal((await a.call('login', c.pin)).status, 200);
  assert.equal((await b.call('login', c.pin)).status, 200);
  assert.notEqual(a.cookie, b.cookie);
  assert.match(a.cookie, /session=/);
});
await check('refresh restores the existing device session without a new workspace', async () => {
  const before = must(await admin.from('projects').select('id'), 'workspace inventory').length;
  assert.equal((await a.call('session')).status, 200);
  assert.equal(must(await admin.from('projects').select('id'), 'workspace inventory').length, before);
  for (const d of [a,b]) assert.equal(must(await d.client().from('projects').select('id').eq('id', workspace), 'canonical access')[0].id, workspace);
});
let category, stage, customer;
await check('authenticated category, stage and customer fixture writes', async () => {
  const cli = a.client(), suffix = randomUUID();
  category = must(await cli.from('categories').insert({ user_id: owner, project_id: workspace, name: 'تصنيف '+suffix }).select().single(), 'category').id;
  stage = must(await cli.from('construction_stages').insert({ user_id: owner, project_id: workspace, name: 'مرحلة '+suffix }).select().single(), 'stage').id;
  customer = must(await cli.from('clients').insert({ user_id: owner, project_id: workspace, name: 'عميل '+suffix }).select().single(), 'customer').id;
});
const row = (amount = '175000.00', type = 'expense') => ({ id: randomUUID(), user_id: owner, project_id: workspace, type, amount, transaction_date: '2026-10-19', description: 'اختبار مالي اصطناعي معزول', category_id: category, stage_id: stage, client_id: customer, person_name: null, notes: null, created_at: new Date().toISOString() });
const payload = (tx, op = randomUUID(), attachment = null) => ({ p_operation_id: op, p_transaction: tx, p_attachment: attachment, p_remove_attachment: false });
let savedRow, savedArgs;
await check('concurrent real transaction RPC retries create exactly one financial row', async () => {
  savedRow = row(); savedArgs = payload(savedRow);
  const responses = await Promise.all(Array.from({ length: 12 }, () => a.client().rpc('beity_save_transaction', savedArgs)));
  responses.forEach(r => assert.equal(must(r, 'save').saved, true));
  assert.equal(must(await b.client().from('transactions').select('id').eq('id', savedRow.id), 'cross-session transaction').length, 1);
  const conflict = await a.client().rpc('beity_save_transaction', { ...savedArgs, p_transaction: { ...savedRow, amount: '1.00' } });
  assert(conflict.error);
});
await check('real transaction constraint failure rolls back receipt and financial row', async () => {
  const bad = row('-1'), args = payload(bad);
  assert((await a.client().rpc('beity_save_transaction', args)).error);
  assert.equal(must(await a.client().from('transactions').select('id').eq('id', bad.id), 'failed transaction').length, 0);
  assert.equal(must(await a.client().rpc('beity_transaction_save_status', { p_operation_id: args.p_operation_id }), 'failed receipt'), null);
});
await check('non-finite numeric input cannot commit a financial row or receipt',async()=>{
 const id=randomUUID(),op=randomUUID();const bad={id,user_id:owner,project_id:workspace,type:'expense',amount:'NaN',transaction_date:'2026-10-20',description:'negative finite fixture',created_at:new Date().toISOString()};
 assert((await b.client().rpc('beity_save_transaction',payload(bad,op))).error);
 assert.equal(must(await admin.from('transactions').select('id').eq('id',id),'no invalid money').length,0);
 assert.equal(must(await admin.from('transaction_save_operations').select('operation_id').eq('operation_id',op),'no invalid receipt').length,0);
});
await check('unuploaded attachment cannot partially commit a transaction', async () => {
  const tx = row(), op = randomUUID();
  const args = payload(tx, op, { file_path: `${owner}/${workspace}/${tx.id}/${op}-absent.pdf`, file_name: 'absent.pdf', file_size: 100, file_type: 'application/pdf' });
  assert((await a.client().rpc('beity_save_transaction', args)).error);
  assert.equal(must(await a.client().from('transactions').select('id').eq('id', tx.id), 'missing-file transaction').length, 0);
});
let filePath, fileTx, fileArgs, bytes;
await check('real Storage upload, atomic metadata save, retry and retrieval hashes', async () => {
  fileTx = row('275000.00'); const op = randomUUID(); bytes = Buffer.from('%PDF-1.4\n% isolated Beity staging file\n%%EOF\n');
  filePath = `${owner}/${workspace}/${fileTx.id}/${op}-${createHash('sha256').update(bytes).digest('hex')}-fixture.pdf`;
  must(await a.client().storage.from('transaction-attachments').upload(filePath, bytes, { contentType: 'application/pdf', upsert: false }), 'storage upload');
  fileArgs = payload(fileTx, op, { file_path: filePath, file_name: 'fixture.pdf', file_size: bytes.length, file_type: 'application/pdf' });
  assert.equal(must(await a.client().rpc('beity_save_transaction', fileArgs), 'attachment save').saved, true);
  assert.equal(must(await a.client().rpc('beity_save_transaction', fileArgs), 'attachment retry').saved, true);
  const blob = must(await b.client().storage.from('transaction-attachments').download(filePath), 'storage retrieval');
  assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
});
await check('Storage rejects invalid MIME upload without financial changes', async () => {
  const tx = row(); const path = `${owner}/${workspace}/${tx.id}/${randomUUID()}-bad.txt`;
  assert((await a.client().storage.from('transaction-attachments').upload(path, Buffer.from('invalid'), { contentType: 'text/plain' })).error);
  assert.equal(must(await a.client().from('transactions').select('id').eq('id', tx.id), 'upload failure transaction').length, 0);
});
await check('two independent sessions report identical exact income/expense/balance', async () => {
  const ids = [savedRow.id, fileTx.id];
  const read = async d => must(await d.client().from('transactions').select('id,type,amount').in('id', ids).order('id'), 'balances');
  const ar = await read(a), br = await read(b); assert.deepEqual(ar, br);
  const cents = ar.reduce((n,r) => n + BigInt(Math.round(Number(r.amount)*100))*(r.type==='income'?1n:-1n), 0n);
  assert.equal(cents, -45000000n);
});
await check('ordinary authenticated clients cannot mint detached download or upload capabilities',async()=>{
 assert((await b.client().storage.from('transaction-attachments').createSignedUrl(filePath,60)).error);
 assert((await b.client().storage.from('transaction-attachments').createSignedUploadUrl(`${owner}/${workspace}/${randomUUID()}/denied.png`)).error);
});
await check('Supabase Realtime delivers a transaction change to another authenticated session', async () => {
  const listener = b.client(); await listener.realtime.setAuth(b.access);
  let done; const received = new Promise(resolve => { done = resolve; });
  const channel = listener.channel('staging-'+randomUUID(),{config:{postgres_changes_options:{wait:true}}}).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'transactions', filter: `project_id=eq.${workspace}` }, message => { if (message.new.id === savedRow.id) done(); });
  try {
    await new Promise((resolve,reject) => { const timer=setTimeout(()=>reject(Error('Realtime subscribe timeout')),20000); channel.subscribe(status => { if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();} if(status==='CHANNEL_ERROR'){clearTimeout(timer);reject(Error('Realtime channel error'));} }); });
    must(await a.client().from('transactions').update({ notes:'Realtime synthetic fixture' }).eq('id',savedRow.id), 'realtime write');
    let timer; try { await Promise.race([received,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Realtime event timeout')),20000);})]); } finally {clearTimeout(timer);}
  } finally { await listener.removeChannel(channel); }
});
await check('anonymous reads and server-only limiter RPC are denied', async () => {
  for(const table of ['profiles','projects','transactions','clients','categories','construction_stages','attachments']) {
    const r=await anonymous.from(table).select('*').limit(1);assert(r.error || r.data.length===0);
  }
  assert((await a.client().rpc('beity_reserve_pin_attempt',{p_identifier_hash:'a'.repeat(64),p_network_hash:'b'.repeat(64)})).error);
});
let foreignFixtureId;
await check('foreign authenticated user cannot read canonical tables or file', async () => {
  const email=`foreign-${randomUUID()}@example.invalid`, password=randomBytes(24).toString('hex');
  foreignFixtureId=must(await admin.auth.admin.createUser({email,password,email_confirm:true}), 'foreign fixture identity').user.id;
  const foreign=createClient(c.url,c.publicKey,opts);must(await foreign.auth.signInWithPassword({email,password}), 'foreign fixture login');
  for(const table of ['projects','transactions','clients','categories','construction_stages','attachments']) assert.equal(must(await foreign.from(table).select('*').eq(table==='projects'?'id':'project_id',workspace), 'foreign RLS').length,0);
  assert.equal(must(await foreign.from('profiles').select('*').eq('user_id',owner),'foreign profile').length,0);
  assert((await foreign.storage.from('transaction-attachments').download(filePath)).error);
  await foreign.auth.signOut();
});
await check('new Auth fixture never automatically creates a profile or financial workspace',async()=>{
 for(const table of ['profiles','projects','categories','construction_stages'])assert.equal(must(await admin.from(table).select(table==='profiles'?'user_id':'id').eq('user_id',foreignFixtureId),'no automatic bootstrap').length,0);
});
await check('locking revokes only this device and rejects refresh-cookie replay and stale JWT RLS', async () => {
  const oldCookie=a.cookie, stale=a.client();assert.equal((await a.call('logout')).status,204);
  assert.equal((await a.call('session',undefined,oldCookie)).status,401);
  for(const table of ['profiles','projects','transactions','clients','categories','construction_stages','attachments']) { const r=await stale.from(table).select('*');assert(r.error || r.data.length===0); }
  assert((await stale.storage.from('transaction-attachments').download(filePath)).error);
  assert.equal((await b.call('session')).status,200);
  assert.equal(must(await b.client().from('transactions').select('id').eq('id',savedRow.id),'other device active').length,1);
});
await check('real centralized limiter admits five of 24 concurrent attempts and isolates another network', async () => {
  const attack=device(ip(3));const replies=await Promise.all(Array.from({length:24},()=>attack.call('login','000000000000')));
  assert.equal(replies.filter(r=>r.status===401).length,5);assert.equal(replies.filter(r=>r.status===429).length,19);
  const healthy=device(ip(4));assert.equal((await healthy.call('login',c.pin)).status,200);assert.equal((await healthy.call('logout')).status,204);
});
await check('real attachment detach and Storage delete preserve the financial transaction', async () => {
  const current=must(await b.client().from('transactions').select('revision').eq('id',fileTx.id).single(),'detach revision');
  const detach={...payload({...fileTx,expected_revision:current.revision}),p_remove_attachment:true};
  const result=must(await b.client().rpc('beity_save_transaction',detach),'detach');assert.deepEqual(result.cleanup_paths,[filePath]);
  must(await b.client().storage.from('transaction-attachments').remove(result.cleanup_paths),'storage delete');
  assert((await b.client().storage.from('transaction-attachments').download(filePath)).error);
  assert.equal(must(await b.client().from('transactions').select('id').eq('id',fileTx.id),'financial row preserved').length,1);
});
await check('stale simultaneous edits cannot silently overwrite a newer financial value',async()=>{
 const current=must(await b.client().from('transactions').select('revision').eq('id',fileTx.id).single(),'edit revision');
 const edits=await Promise.all([b.client().rpc('beity_save_transaction',payload({...fileTx,notes:'first concurrent fixture edit',expected_revision:current.revision})),b.client().rpc('beity_save_transaction',payload({...fileTx,notes:'second concurrent fixture edit',expected_revision:current.revision}))]);
 assert.equal(edits.filter(r=>!r.error).length,1);assert.equal(edits.filter(r=>r.error?.code==='PT409').length,1);
});
await b.call('logout');
await check('only this run synthetic transactions enter Trash and the original active baseline remains exact',async()=>{
 const ids=[savedRow?.id,fileTx?.id].filter(Boolean);
 if(ids.length)must(await admin.from('transactions').update({deleted_at:new Date().toISOString()}).in('id',ids),'synthetic fixture soft delete');
 const after=must(await admin.from('transactions').select('id,type,amount').eq('project_id',workspace).is('deleted_at',null).order('id'),'active fixture preservation');
 assert.deepEqual(after,activeBefore);
});
const failed=evidence.checks.filter(x=>x.result==='FAIL').length;
console.log(`Hosted staging: ${evidence.checks.length-failed} passed; ${failed} failed. No production requests made.`);
// All requests and logout operations above are awaited. Close this one-shot CLI
// even if the SDK retains an idle socket after removing the Realtime channel.
process.exit(failed?1:0);
