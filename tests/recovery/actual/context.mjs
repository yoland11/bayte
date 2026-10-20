import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {readEncryptedArchive} from '../../../scripts/lib/encrypted-backup.mjs';
export const ROOT=process.cwd();
function privatePath(p){assert(p&&path.isAbsolute(p),'Explicit private path required');const real=fs.realpathSync(p),s=fs.statSync(real);assert(!real.startsWith(ROOT+path.sep)&&real!==ROOT,'Recovery inputs must be outside project');assert.equal(s.uid,process.getuid());assert.equal(s.mode&0o077,0,'Private owned input required');return real;}
const file=privatePath(process.env.BEITY_ACTUAL_RECOVERY_CONFIG);export const config=JSON.parse(fs.readFileSync(file,'utf8'));
export const P=privatePath(config.workdir);assert(fs.statSync(P).isDirectory());
assert(/^beity-actual-recovery-\d{8}(?:-[a-z0-9]+)?$/.test(config.projectId),'Disposable recovery project required');
assert.equal(config.sourceProjectRef,'irnwbayhxawphkxmbnbx');assert(!fs.existsSync(P+'/recovery-new/supabase/.temp/project-ref'),'Linked targets forbidden');
assert(fs.readFileSync(P+'/recovery-new/supabase/config.toml','utf8').includes('project_id = "'+config.projectId+'"'));
assert(config.port>=55000&&config.port<=55999&&Number.isInteger(config.port));
privatePath(config.keyPath);privatePath(config.pinHashPath);privatePath(config.pinProvider);
assert(path.isAbsolute(config.evidencePath)&&!fs.existsSync(config.evidencePath+'.frozen'),'Frozen evidence cannot be overwritten');
export const entries=name=>readEncryptedArchive({directory:config.backupDirectory,keyPath:config.keyPath,projectRef:config.sourceProjectRef,name});
