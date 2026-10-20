import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import zlib from 'node:zlib';
// Memory-only reader. No SQL execution, network access, extraction or diagnostic payloads.
export function readEncryptedArchive({directory,keyPath,projectRef,name}){
 let key;
 try{
  if(!/^[a-z0-9][a-z0-9-]*\.tar\.gz\.aesgcm$/.test(name)||!projectRef)throw Error();
  const stat=fs.lstatSync(keyPath);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)||stat.uid!==process.getuid())throw Error();
  key=fs.readFileSync(keyPath);if(key.length!==32)throw Error();
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
  const expected=manifest.archives.find(a=>a.name===name)?.sha256;
  const b=fs.readFileSync(path.join(directory,name)),header=Buffer.from('BEITY-AES256GCM-v1\0');
  if(!expected||crypto.createHash('sha256').update(b).digest('hex')!==expected||b.length<header.length+28||!b.subarray(0,header.length).equals(header))throw Error();
  const d=crypto.createDecipheriv('aes-256-gcm',key,b.subarray(header.length,header.length+12));d.setAAD(Buffer.from(projectRef+':'+name));d.setAuthTag(b.subarray(-16));
  const tar=zlib.gunzipSync(Buffer.concat([d.update(b.subarray(header.length+12,-16)),d.final()]),{maxOutputLength:128*1024*1024}),out=Object.create(null);
  for(let i=0;i+512<=tar.length;){const h=tar.subarray(i,i+512);if(h.every(v=>v===0))break;
   const text=(a,b)=>h.subarray(a,b).toString().replace(/\0.*$/s,'');
   const n=text(0,100),size=parseInt(text(124,136).trim()||'0',8),type=text(156,157);
   const expectedSum=parseInt(text(148,156).trim(),8);let sum=0;for(let j=0;j<512;j++)sum+=j>=148&&j<156?32:h[j];
   if(sum!==expectedSum||!Number.isSafeInteger(size)||size<0||i+512+size>tar.length||n.startsWith('/')||n.split('/').includes('..')||['1','2'].includes(type))throw Error();
   if(type!=='5')out[n]=tar.subarray(i+512,i+512+size);
   i+=512+Math.ceil(size/512)*512;
  }
  return out;
 }catch{throw Error('Backup verification failed');}finally{key?.fill(0);}
}
