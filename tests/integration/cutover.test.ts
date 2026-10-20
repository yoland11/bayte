import {it,expect} from 'vitest';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {readFile,readdir} from 'node:fs/promises';
const exec=promisify(execFile),base=process.env.BEITY_TEST_DATABASE_URL;
it.skipIf(!base)('freezes legacy writes before migrations and hands off without reopening writes',async()=>{
 const url=new URL(base!);if(!['127.0.0.1','localhost'].includes(url.hostname)||!url.pathname.startsWith('/beity_test_'))throw Error('Isolated database required');
 const name='beity_test_cutover_'+Date.now();const admin=new URL(url);admin.pathname='/postgres';
 await exec('psql',[admin.href,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',`create database ${name}`]);url.pathname='/'+name;
 const sql=async(q:string)=>(await exec('psql',[url.href,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',q])).stdout.trim();
 const file=async(p:string)=>sql(await readFile(p,'utf8'));
 try{
 await file('tests/integration/bootstrap.sql');
 const migrations=(await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort();
 for(const m of migrations.slice(0,3))await file('supabase/migrations/'+m);
 const u='e4afb7c8-0915-4b5f-8805-66c292a5d3b6',p='4324284c-2650-4eaa-86bd-152fbd1e8c2e',s='00000000-0000-4000-8000-000000000099';
 await sql(`insert into auth.users(id) values('${u}');insert into auth.sessions values('${s}','${u}');insert into public.projects(id,user_id,name) values('${p}','${u}','isolated cutover');grant select,insert,update,delete on all tables in schema public,storage to authenticated;`);
 const claims=`set role authenticated;set request.jwt.claims='{"sub":"${u}","session_id":"${s}","role":"authenticated"}';`;
 const insert=`insert into public.transactions(id,user_id,project_id,type,amount,transaction_date,description) values(gen_random_uuid(),'${u}','${p}','expense',175000,'2026-10-19','isolated cutover');`;
 await sql(claims+insert);const baseline=await sql('select count(*)||\':\'||sum(amount) from public.transactions');
 const blocker=sql('begin;lock table public.transactions in row exclusive mode;select pg_sleep(6) /*beity_cutover_lock_fixture*/;commit;');
 for(let i=0;i<30;i++){
  if(await sql("select count(*) from pg_stat_activity where wait_event='PgSleep' and query like '%beity_cutover_lock_fixture%'")!=='0')break;
  await new Promise(r=>setTimeout(r,25));
 }
 await expect(file('maintenance/enter-cutover.sql')).rejects.toThrow();
 expect(await sql("select count(*) from pg_policies where policyname like 'beity_cutover_%'")).toBe('0');
 await blocker;
 await file('maintenance/enter-cutover.sql');await expect(sql(claims+insert)).rejects.toThrow();
 // Legacy SECURITY DEFINER bootstrap bypasses ordinary RLS: the freeze must cover it too.
 await expect(sql("insert into auth.users(id) values(gen_random_uuid())")).rejects.toThrow();
 await expect(sql(insert)).rejects.toThrow();
 for(const m of migrations.slice(3))await file('supabase/migrations/'+m);
 await expect(file('maintenance/handoff-cutover.sql')).rejects.toThrow();
 expect(await sql("select count(*) from pg_policies where policyname like 'beity_cutover_%'")).toBe('24');
 await file('maintenance/activate.sql');await file('maintenance/handoff-cutover.sql');
 expect(await sql("select count(*) from pg_policies where policyname like 'beity_cutover_%'")).toBe('0');
 await expect(sql(claims+insert)).rejects.toThrow();expect(await sql('select count(*)||\':\'||sum(amount) from public.transactions')).toBe(baseline);
 await file('maintenance/deactivate.sql');await sql(claims+insert);
 expect(await sql('select count(*) from public.transactions')).toBe('2');
 }finally{await exec('psql',[admin.href,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',`drop database ${name} with (force)`]);}
},30000);
