// LOCAL OPERATOR ONLY. stdout is exactly MATCH, NO MATCH, or BLOCKED.
import {emitKeypressEvents} from 'node:readline';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdtemp,writeFile,rm,mkdir,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join,resolve,relative,sep} from 'node:path';
const input=process.stdin,mode=process.argv[2],flags=process.argv.slice(3);
const privateDir=resolve(process.env.BEITY_OPERATOR_STATE_DIR||join(homedir(),'.codex/private/beity-production-provisioning'));
let phase='terminal',candidate='',directory,status='BLOCKED',reason='TERMINAL_REQUIRED';
let argon2,verifyCanonicalPassword,verifyExistingPin,readPrivateFile,savePrivateFile;
function hidden(prompt){return new Promise((resolveInput,reject)=>{
 let value='';
 const done=()=>{input.removeListener('keypress',key);input.setRawMode(false);input.pause();process.stderr.write('\n');};
 const key=(text,k)=>{if(k?.ctrl&&k.name==='c'){done();const e=Error();e.code='OPERATOR_CANCELLED';reject(e);}else if(['return','enter'].includes(k?.name)){done();resolveInput(value);}else if(['backspace','delete'].includes(k?.name)){value=value.slice(0,-1);}else if(text&&!k?.ctrl&&!k?.meta&&value.length<1024){value+=text;}};
 // Disable echo and install the handler BEFORE publishing the prompt.
 emitKeypressEvents(input);input.setRawMode(true);input.on('keypress',key);input.resume();process.stderr.write(prompt);
});}
const normalizePin=s=>s.replace(/[\u0660-\u0669\u06f0-\u06f9]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660)));
async function savePair(account,password){
 const paths=['canonical-email.txt','canonical-password.txt'].map(x=>join(privateDir,x));
 for(const p of paths){try{await readFile(p);const e=Error();e.code='EEXIST';throw e;}catch(e){if(e.code!=='ENOENT')throw e;}}
 await savePrivateFile(paths[0],account.email);
 try{await savePrivateFile(paths[1],password);}catch(e){await rm(paths[0]);throw e;}
}
async function record(){
 const rel=relative(process.cwd(),privateDir);if(rel===''||(!rel.startsWith('..'+sep)&&rel!=='..'))return;
 await mkdir(privateDir,{recursive:true,mode:0o700});
 const safeMode=['password','pin','pin-create'].includes(mode)?mode:'invalid';
 const receipt=JSON.stringify({mode:safeMode,status,phase,reason,at:new Date().toISOString(),productionChanges:0,historicalPinComparison:mode==='pin'},null,2);
 for(const name of ['last-verification.json',`last-verification-${safeMode}.json`]){
  const f=await open(join(privateDir,name),constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
  try{await f.chmod(0o600);await f.writeFile(receipt);}finally{await f.close();}
 }
}
try{
 if(!input.isTTY||!input.setRawMode)throw Error();
 phase='dependencies';reason='DEPENDENCY_UNAVAILABLE';
 argon2=(await import('@node-rs/argon2')).default;
 ({verifyCanonicalPassword,verifyExistingPin,readPrivateFile,savePrivateFile}=await import('./lib/operator-credentials.mjs'));
 phase='arguments';reason='INVALID_ARGUMENTS';
 if(!['password','pin','pin-create'].includes(mode)||flags.some(x=>!['--save-verified','--confirm-existing-pin'].includes(x)))throw Error();
 if(mode==='pin'||mode==='pin-create'){
  phase='pin_hash_read';reason='PRODUCTION_PIN_HASH_UNAVAILABLE';let hash;
  if(mode==='pin')hash=await readPrivateFile(join(privateDir,'pin-hash.txt'));
  else{
   reason='PIN_CREATION_APPROVAL_REQUIRED';if(!flags.includes('--confirm-existing-pin'))throw Error();
   reason='EXISTING_HASH_MUST_NOT_BE_REPLACED';
   try{await readFile(join(privateDir,'pin-hash.txt'));throw Error();}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  phase='pin_input';reason='PIN_INPUT_FAILED';candidate=normalizePin(await hidden('Enter the UNCHANGED existing PIN (hidden): '));
  if(mode==='pin-create'){
   const second=normalizePin(await hidden('Confirm the SAME existing PIN (hidden): '));
   if(!/^\d{4,12}$/.test(candidate)||candidate!==second){status='NO MATCH';reason='PIN_CONFIRMATION_MISMATCH';}
   else{phase='pin_create';reason='PIN_HASH_CREATION_FAILED';hash=await argon2.hash(candidate,{algorithm:argon2.Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1,outputLen:32});if(!await verifyExistingPin(hash,candidate))throw Error();await savePrivateFile(join(privateDir,'pin-hash.txt'),hash+'\n');status='MATCH';reason='CONFIRMED_EXISTING_PIN_HASH_CREATED_LOCALLY';}
  }else{phase='pin_compare';status=await verifyExistingPin(hash,candidate)?'MATCH':'NO MATCH';reason=status==='MATCH'?'EXISTING_HASH_MATCHED':'PIN_MISMATCH_OR_UNAPPROVED_HASH';}
 }else{
  phase='project_link';reason='PRODUCTION_PROJECT_LINK_INVALID';
  if((await readFile('supabase/.temp/project-ref','utf8')).trim()!=='irnwbayhxawphkxmbnbx')throw Error();
  directory=await mkdtemp(join(tmpdir(),'beity-readonly-credential-'));const sql=join(directory,'identity.sql');
  await writeFile(sql,"begin read only; select id,email,encrypted_password from auth.users where id='e4afb7c8-0915-4b5f-8805-66c292a5d3b6'; commit;",{mode:0o600});
  phase='readonly_database_query';reason='CANONICAL_READONLY_QUERY_FAILED';
  const result=await promisify(execFile)('supabase',['db','query','--linked','--file',sql,'--output','json'],{cwd:process.cwd(),maxBuffer:1024*1024,timeout:60000});
  phase='database_response';reason='INVALID_CANONICAL_DATABASE_RESPONSE';
  const rows=JSON.parse(result.stdout).rows;if(rows?.length!==1)throw Error();
  phase='password_input';reason='PASSWORD_INPUT_FAILED';candidate=await hidden('Enter the ORIGINAL canonical password (hidden): ');
  phase='password_compare';reason='UNSUPPORTED_CANONICAL_ACCOUNT_OR_HASH';
  status=await verifyCanonicalPassword(rows[0],candidate)?'MATCH':'NO MATCH';reason=status==='MATCH'?'ORIGINAL_PASSWORD_MATCHED':'PASSWORD_MISMATCH';
  if(status==='MATCH'&&flags.includes('--save-verified')){
   phase='save_confirmation';const confirmation=await hidden('Save verified original credential privately? Type SAVE (hidden), or Enter to skip: ');
   if(confirmation==='SAVE'){phase='private_credential_save';reason='PRIVATE_CREDENTIAL_SAVE_FAILED';await savePair(rows[0],candidate);reason='ORIGINAL_PASSWORD_MATCHED_AND_SAVED_PRIVATELY';}
  }
 }
}catch(e){status='BLOCKED';if(e.code==='OPERATOR_CANCELLED')reason='OPERATOR_CANCELLED';else if(e.code==='EEXIST')reason='PRIVATE_FILE_ALREADY_EXISTS_NO_OVERWRITE';else if(e.code==='ENOENT'&&phase==='readonly_database_query')reason='SUPABASE_CLI_NOT_FOUND';else if(e.killed&&phase==='readonly_database_query')reason='CANONICAL_READONLY_QUERY_TIMEOUT';}
finally{
 candidate='';if(directory)await rm(directory,{recursive:true,force:true});if(input.isRaw)input.setRawMode(false);input.pause();
 if(input.isTTY)try{await record();}catch{/* Never expose errors, query output, candidates or hashes. */}
 process.stdout.write(status+'\n');process.exitCode=status==='MATCH'?0:status==='NO MATCH'?1:2;
}
