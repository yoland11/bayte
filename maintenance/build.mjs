import {mkdir,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const out=process.argv[2]||'dist';await mkdir(out,{recursive:true});await copyFile(fileURLToPath(new URL('./index.html',import.meta.url)),out+'/index.html');
