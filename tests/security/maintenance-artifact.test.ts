import {it,expect} from 'vitest';import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
it('declines API requests instead of returning a misleading successful logout page',async()=>{
 const config=JSON.parse(await readFile('maintenance/vercel.json','utf8'));
 expect(config.routes.find((r:{src:string})=>r.src.includes('/api')).status).toBe(503);
 expect(config.rewrites).toBeUndefined();
});
it('builds an independent static maintenance artifact without auth code, API handlers or environment secrets',async()=>{const dir=await mkdtemp(join(tmpdir(),'beity-maintenance-test-'));try{await promisify(execFile)(process.execPath,['maintenance/build.mjs',dir],{env:{...process.env,SUPABASE_SERVICE_ROLE_KEY:'synthetic-secret-must-not-ship'}});expect(await readdir(dir)).toEqual(['index.html']);const html=await readFile(join(dir,'index.html'),'utf8');expect(html).toContain('النظام قيد الصيانة مؤقتًا');expect(html).toContain('dir="rtl"');expect(html).not.toMatch(/<script|<form|supabase|synthetic-secret-must-not-ship/i);}finally{await rm(dir,{recursive:true,force:true});}});
