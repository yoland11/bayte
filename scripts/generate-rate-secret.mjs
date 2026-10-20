import {randomBytes} from 'node:crypto';import {mkdir,writeFile} from 'node:fs/promises';import {homedir} from 'node:os';import {resolve,dirname,relative} from 'node:path';
const output=resolve(process.argv[2]||homedir()+'/.codex/private/beity-production-provisioning/rate-secret.txt');
if(!relative(process.cwd(),output).startsWith('..'))throw Error('Secret output must be outside the project');
await mkdir(dirname(output),{recursive:true,mode:0o700});await writeFile(output,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});process.stdout.write('Rate-limit secret saved privately outside the project; no value printed.\n');
