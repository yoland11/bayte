import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,symlink,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import argon2 from '@node-rs/argon2';
import bcrypt from 'bcryptjs';
// @ts-expect-error Local operator module, intentionally not part of the browser build.
import {verifyCanonicalPassword,verifyExistingPin,readPrivateFile,savePrivateFile} from '../../scripts/lib/operator-credentials.mjs';
it('verifies the existing canonical bcrypt hash without mutating identity',async()=>{
 const account={id:'e4afb7c8-0915-4b5f-8805-66c292a5d3b6',email:'fixture@example.invalid',encrypted_password:await bcrypt.hash('synthetic-password-only',4)};
 expect(await verifyCanonicalPassword(account,'synthetic-password-only')).toBe(true);
 expect(await verifyCanonicalPassword(account,'incorrect')).toBe(false);
 await expect(verifyCanonicalPassword({...account,id:'other'},'synthetic-password-only')).rejects.toThrow();
 await expect(verifyCanonicalPassword({...account,encrypted_password:'unrecognized'},'synthetic-password-only')).rejects.toThrow();
});
it('verifies an existing approved Argon2 PIN hash and rejects weaker parameters',async()=>{
 const opts={algorithm:argon2.Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1};
 const hash=await argon2.hash('4826',opts);
 expect(await verifyExistingPin(hash,'4826')).toBe(true);
 expect(await verifyExistingPin(hash,'4827')).toBe(false);
 expect(await verifyExistingPin(await argon2.hash('4826',{...opts,memoryCost:8192}),'4826')).toBe(false);
});
it('requires private external regular files, refuses symlinks and never overwrites',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'beity-operator-'));try{
 const p=join(dir,'secret');await savePrivateFile(p,'synthetic-private-value');
 expect(await readPrivateFile(p)).toBe('synthetic-private-value');
 await expect(savePrivateFile(p,'replacement')).rejects.toThrow();expect(await readFile(p,'utf8')).toBe('synthetic-private-value');
 const link=join(dir,'link');await symlink(p,link);await expect(readPrivateFile(link)).rejects.toThrow();
 const world=join(dir,'world');await writeFile(world,'synthetic',{mode:0o644});await expect(readPrivateFile(world)).rejects.toThrow();
 await expect(savePrivateFile(join(process.cwd(),'forbidden-operator-secret'),'x')).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
it('refuses noninteractive credential input before touching production',()=>{
 for(const mode of ['password','pin']){
 const r=spawnSync(process.execPath,['scripts/verify-production-credentials.mjs',mode],{input:'synthetic-input\n',encoding:'utf8'});
 expect(r.status).not.toBe(0);expect(r.stdout.trim()).toBe('BLOCKED');
 expect(r.stdout+r.stderr).not.toContain('synthetic-input');
 }
});
it.each([true,false])('uses hidden real TTY input and returns only the exact status (match=%s)',async(match)=>{
 const dir=await mkdtemp(join(tmpdir(),'beity-tty-'));try{
 const bin=join(dir,'bin');await mkdir(bin);const password='synthetic-tty-password';const hash=await bcrypt.hash(password,4);
 const account={id:'e4afb7c8-0915-4b5f-8805-66c292a5d3b6',email:'fixture@example.invalid',encrypted_password:hash};
 await writeFile(join(bin,'supabase'),'#!/usr/bin/env node\nprocess.stdout.write('+JSON.stringify(JSON.stringify({rows:[account]}))+');\n',{mode:0o700});
 const path=join(dir,'fixture.json');await writeFile(path,JSON.stringify({bin,hash,stateDir:join(dir,'state'),candidate:match?password:'incorrect-synthetic-tty'}),{mode:0o600});
 const r=spawnSync('python3',['tests/fixtures/operator-tty.py',path],{encoding:'utf8',timeout:15000});expect(r.status).toBe(0);
 const result=JSON.parse(r.stdout);expect(result.inputSent).toBe(true);expect(result.secretEchoed).toBe(false);expect(result.hashEchoed).toBe(false);expect(result.status).toBe(match?'MATCH':'NO MATCH');
 expect(JSON.parse(await readFile(join(dir,'state','last-verification-password.json'),'utf8')).status).toBe(match?'MATCH':'NO MATCH');
 }finally{await rm(dir,{recursive:true,force:true});}
},20000);
it('creates a local hash only from twice-confirmed existing PIN, with no historical-match claim or overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'beity-pin-create-'));try{
 const stateDir=join(dir,'state'),path=join(dir,'fixture.json');
 await writeFile(path,JSON.stringify({bin:dir,stateDir,mode:'pin-create',flags:['--confirm-existing-pin'],responses:['4826','4826'],candidate:'4826',hash:'nonexistent-historical-fixture'}),{mode:0o600});
 const run=()=>spawnSync('python3',['tests/fixtures/operator-tty.py',path],{encoding:'utf8',timeout:15000});
 const first=run();expect(first.status).toBe(0);expect(JSON.parse(first.stdout)).toMatchObject({status:'MATCH',secretEchoed:false});
 const hash=await readPrivateFile(join(stateDir,'pin-hash.txt'));expect(await verifyExistingPin(hash,'4826')).toBe(true);
 const result=JSON.parse(await readFile(join(stateDir,'last-verification.json'),'utf8'));expect(result.historicalPinComparison).toBe(false);
 expect(JSON.parse(run().stdout).status).toBe('BLOCKED');expect(await readPrivateFile(join(stateDir,'pin-hash.txt'))).toBe(hash);
 }finally{await rm(dir,{recursive:true,force:true});}
},20000);
