// Staging-only rehearsal. Production rotation is deliberately not implemented here.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import argon2 from '@node-rs/argon2';
import {generateInternalCredential,assertRotationTarget} from '../../scripts/lib/internal-credential.mjs';
const c=JSON.parse(readFileSync(process.env.BEITY_STAGING_CONFIG,'utf8'));
const uid='e4afb7c8-0915-4b5f-8805-66c292a5d3b6',workspace='4324284c-2650-4eaa-86bd-152fbd1e8c2e';
assertRotationTarget(c.projectRef,uid);assert.equal(c.url,'https://kwuhkahuhacemmgbgffw.supabase.co');assert.equal(process.env.BEITY_ALLOW_STAGING_WRITES,c.projectRef);
const opts={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}},admin=createClient(c.url,c.serviceKey,opts),fresh=()=>createClient(c.url,c.publicKey,opts);
const must=r=>{assert(!r.error,'Staging operation rejected');return r.data;};
const evidence={stagingOnly:true,productionWrites:0,canonicalUserId:uid,workspaceId:workspace,checks:[]};
const output=process.env.BEITY_STAGING_EVIDENCE;assert(output);
function pass(name){evidence.checks.push({name,result:'PASS'});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log('PASS: '+name);}
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function snapshot(){const out={};for(const t of ['profiles','projects','transactions','clients','categories','construction_stages','attachments'])out[t]=must(await admin.from(t).select('*').order(t==='profiles'?'user_id':'id'));return out;}
async function files(rows){const out=[];for(const a of rows){const blob=must(await admin.storage.from('transaction-attachments').download(a.file_path));out.push([a.id,createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex')]);}return hash(out);}
const before=await snapshot(),beforeHash=hash(before),fileHash=await files(before.attachments);
assert.equal(before.projects.find(p=>p.id===workspace).user_id,uid);
const originalUser=must(await admin.auth.admin.getUserById(uid)).user;
const originalUsers=must(await admin.auth.admin.listUsers({perPage:1000})).users.map(u=>u.id).sort();
const old=fresh(),oldAuth=must(await old.auth.signInWithPassword({email:c.email,password:c.password}));
let changed=false,attemptedRotation=false;const next=generateInternalCredential();
try{
 // No explicit global revocation precedes the rotation: measure the provider side effect itself.
 attemptedRotation=true;const updated=must(await admin.auth.admin.updateUserById(uid,{password:next})).user;changed=true;
 assert.equal(updated.id,uid);assert.equal(updated.email,originalUser.email);pass('Admin password rotation preserves existing user ID and email');
 assert((await fresh().auth.signInWithPassword({email:c.email,password:c.password})).error);pass('previous internal credential no longer authenticates');
 Object.assign(process.env,{VERCEL_ENV:'preview',SUPABASE_URL:c.url,VITE_SUPABASE_URL:c.url,SUPABASE_PUBLISHABLE_KEY:c.publicKey,VITE_SUPABASE_PUBLISHABLE_KEY:c.publicKey,SUPABASE_SERVICE_ROLE_KEY:c.serviceKey,BEITY_CANONICAL_EMAIL:c.email,BEITY_CANONICAL_PASSWORD:next,BEITY_RATE_LIMIT_SECRET:c.rateSecret,BEITY_PIN_ARGON2_HASH:await argon2.hash(c.pin,{algorithm:argon2.Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1,outputLen:32})});
 const h=await import(pathToFileURL(process.env.BEITY_STAGING_HANDLERS));
 async function call(route,cookie='',token=''){
  let status=200,data;const headers={};const res={status(n){status=n;return res;},setHeader(k,v){headers[k.toLowerCase()]=v;},json(x){data=x;},end(){}};
  await h[route]({method:route==='session'?'GET':'POST',headers:{host:'rotation.test',origin:'https://rotation.test','x-real-ip':'2001:db8:'+randomBytes(2).toString('hex')+'::1',cookie,authorization:'Bearer '+token},body:{pin:c.pin}},res);
  return {status,data,cookie:headers['set-cookie']?.split(';')[0]};
 }
 const one=await call('login'),two=await call('login');assert.equal(one.status,200);assert.equal(two.status,200);
 const client=token=>createClient(c.url,c.publicKey,{...opts,global:{headers:{Authorization:'Bearer '+token}}});
 for(const d of [one,two])assert.equal(must(await client(d.data.accessToken).from('projects').select('id,user_id').eq('id',workspace).single()).user_id,uid);
 pass('unchanged PIN authenticates two independent server-managed sessions to original workspace');
 assert.deepEqual(must(await client(one.data.accessToken).from('transactions').select('*').order('id')),must(await client(two.data.accessToken).from('transactions').select('*').order('id')));pass('both PIN sessions read identical financial records');
 const revokedRead=await client(oldAuth.session.access_token).from('transactions').select('id');assert(revokedRead.error||revokedRead.data.length===0);assert((await fresh().auth.refreshSession({refresh_token:oldAuth.session.refresh_token})).error);pass('password rotation alone invalidates old access and refresh before any explicit global sign-out');
 const refreshed=await call('session',one.cookie);assert.equal(refreshed.status,200);assert.equal((await call('logout',refreshed.cookie,refreshed.data.accessToken)).status,204);
 assert.equal((await call('session',refreshed.cookie)).status,401);assert.equal((await call('session',two.cookie)).status,200);pass('refresh and device-local logout remain functional without locking other device');
 assert.equal(hash(await snapshot()),beforeHash);assert.equal(await files(before.attachments),fileHash);assert.deepEqual(must(await admin.auth.admin.listUsers({perPage:1000})).users.map(u=>u.id).sort(),originalUsers);pass('all seven data tables, workspace ownership, attachment bytes and account set remain unchanged');
 evidence.result='PASS';
} catch {evidence.result='FAIL';process.exitCode=1;console.log('FAIL: rotation rehearsal; no credentials printed');}
finally{
 if(attemptedRotation){const restored=await admin.auth.admin.updateUserById(uid,{password:c.password});if(restored.error){evidence.stagingCredentialRestored=false;process.exitCode=1;}else{
 const restoredClient=fresh(),r=await restoredClient.auth.signInWithPassword({email:c.email,password:c.password});evidence.stagingCredentialRestored=!r.error&&r.data.user.id===uid;if(r.data.session)await admin.auth.admin.signOut(r.data.session.access_token,'global');assert(evidence.stagingCredentialRestored);}}
 writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
}
