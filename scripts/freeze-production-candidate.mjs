// Local packaging only: no network, environment provisioning, Git or deployment.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),root=process.cwd();
const parent=JSON.parse(fs.readFileSync('docs/safety-candidate-2026-10-20/release-manifest.json'));
const runtime=parent.runtimeFiles.map(r=>({path:r.path,sha256:sha(fs.readFileSync(r.path))}));
const digest=sha(runtime.map(r=>r.path+'\0'+r.sha256+'\n').join(''));const releaseId='beity-2026-10-21-'+digest.slice(0,12)+'-r2';
const destination='docs/'+releaseId;assert(!fs.existsSync(destination),'Frozen package already exists; do not overwrite');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.name==='__pycache__'?[]:e.isDirectory()?walk(path.join(p,e.name)):e.isFile()?[path.join(p,e.name)]:[]);
const files=new Set(runtime.map(r=>r.path));for(const d of ['src','api','public','tests','scripts','maintenance','supabase/migrations'])for(const f of walk(d))files.add(f);
for(const f of ['package.json','package-lock.json','tsconfig.json','tsconfig.api.json','tsconfig.node.json','vite.config.ts','vercel.json','index.html','.vercelignore','.env.server.example','.env.example','Dockerfile','.dockerignore','docker-compose.yml','README.md'])if(fs.existsSync(f))files.add(f);
files.add('docs/BEITY_COMPLETION_AND_EXECUTION_2026-10-21.md');
for(const f of fs.readdirSync('docs'))if((f.startsWith('completion-final-')||f==='safety-backup-reverification-2026-10-20.json'||f==='preparation-recovery-key-custody-2026-10-20.json')&&/\.(json|png|jpg)$/.test(f))files.add('docs/'+f);
const source=[...files].sort().map(f=>{assert(!f.includes('..')&&!/(^|\/)\.env(?:\.local|\.production|$)/.test(f));return{path:f,sha256:sha(fs.readFileSync(f))};});
const migrations=walk('supabase/migrations').sort().filter(f=>/202610(17|18|19|20)/.test(f)).map(f=>({path:f,sha256:sha(fs.readFileSync(f))}));assert.equal(migrations.length,8);
// Frozen historical migration hashes remain independently available in the parent package.
const manifest={releaseId,parentRelease:parent.releaseId,date:'2026-10-21',runtimeDigestDefinition:'SHA256(path + NUL + SHA256(file) + LF), runtime manifest order',runtimeSourceDigestSha256:digest,runtimeFiles:runtime,sourceFiles:source,pendingMigrations:migrations,productionAuthorized:false,productionRecommendation:'NO-GO: exposed unchanged sole PIN; historical signed-URL residual decision pending',preview:'https://beity-staging-audit-2clo10ldc-hussens-projects-39c48423.vercel.app'};
fs.mkdirSync(destination);fs.writeFileSync(destination+'/release-manifest.json',JSON.stringify(manifest,null,2)+'\n');
const list=destination+'/archive-files.txt';fs.writeFileSync(list,source.map(r=>r.path).concat(destination+'/release-manifest.json').join('\n')+'\n');
const archive='docs/'+releaseId+'.tar.gz';assert(!fs.existsSync(archive));execFileSync('tar',['-czf',archive,'-T',list],{stdio:'pipe'});const checksum=sha(fs.readFileSync(archive));fs.writeFileSync(destination+'/archive-sha256.txt',checksum+'  '+path.basename(archive)+'\n');
const extracted=execFileSync('tar',['-tzf',archive],{encoding:'utf8'}).trim().split('\n');assert.equal(extracted.length,source.length+1);for(const r of source)assert.equal(sha(execFileSync('tar',['-xOzf',archive,r.path],{maxBuffer:128*1024*1024})),r.sha256);fs.writeFileSync(destination+'/verification.json',JSON.stringify({releaseId,sourceFileCount:source.length,runtimeFiles:runtime.length,pendingMigrations:migrations.length,archiveSha256:checksum,allArchivedSourceHashesMatch:true,secretsNotIntendedInPackage:true,productionModified:false},null,2)+'\n');console.log(JSON.stringify({releaseId,archive,sourceFileCount:source.length,archiveSha256:checksum}));
