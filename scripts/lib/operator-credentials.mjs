import bcrypt from 'bcryptjs';
import argon2 from '@node-rs/argon2';
import {open,mkdir,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,relative,dirname,sep} from 'node:path';
export const CANONICAL_USER='e4afb7c8-0915-4b5f-8805-66c292a5d3b6';
export async function verifyCanonicalPassword(account,candidate){
 if(account?.id!==CANONICAL_USER||!account.email||!/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(account.encrypted_password??''))throw Error('Unsupported canonical credential');
 return bcrypt.compare(candidate,account.encrypted_password);
}
export async function verifyExistingPin(hash,candidate){
 if(!/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/.test(hash)||!/^\d{4,12}$/.test(candidate))return false;
 try{return await argon2.verify(hash,candidate);}catch{return false;}
}
async function external(path){
 const full=resolve(path),parent=await realpath(dirname(full));
 const actual=resolve(parent,full.slice(dirname(full).length+1));
 const inside=relative(await realpath(process.cwd()),actual);
 if(inside===''||(!inside.startsWith('..'+sep)&&inside!=='..'))throw Error('Private files must be outside the project');
 return actual;
}
export async function readPrivateFile(path){
 const full=await external(path);const f=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=await f.stat();if(!s.isFile()||(s.mode&0o077)||s.uid!==process.getuid()||s.size>16384)throw Error('Private owned regular file required');return (await f.readFile('utf8')).trim();}finally{await f.close();}
}
export async function savePrivateFile(path,value){
 await mkdir(dirname(resolve(path)),{recursive:true,mode:0o700});const full=await external(path);
 const f=await open(full,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{await f.writeFile(value);}finally{await f.close();}
}
