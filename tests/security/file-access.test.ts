import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {createServer,type Server} from 'node:http';
import handler from '../../api/files/read.js';
import {type ApiResponse,CANONICAL_USER_ID} from '../../api/_lib/auth.js';
let server:Server;let active=true;let fileRequests=0;
const project='4324284c-2650-4eaa-86bd-152fbd1e8c2e',id='fe02034d-98a6-448b-a42b-c6534fc49369';
beforeAll(async()=>{server=createServer((req,res)=>{const reply=(n:number,data:unknown)=>{res.writeHead(n,{'content-type':'application/json'});res.end(JSON.stringify(data));};
if(req.url?.includes('/user'))return reply(200,{id:CANONICAL_USER_ID});
if(req.url?.includes('/rpc/beity_session_active'))return reply(200,active);
if(req.url?.includes('/attachments'))return reply(200,{file_path:`${CANONICAL_USER_ID}/${project}/${id}/fixture.png`,file_name:'فاتورة.png',file_type:'image/png'});
if(req.url?.includes('/object/')){fileRequests++;res.writeHead(200,{'content-type':'image/png'});res.end(Buffer.from([1,2,3]));return;}
reply(404,{});});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const a=server.address();if(!a||typeof a==='string')throw Error();vi.stubEnv('SUPABASE_URL',`http://127.0.0.1:${a.port}`);vi.stubEnv('VITE_SUPABASE_URL',`http://127.0.0.1:${a.port}`);vi.stubEnv('SUPABASE_PUBLISHABLE_KEY','isolated-public');vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','isolated-public');});
afterAll(async()=>{vi.unstubAllEnvs();await new Promise<void>(r=>server.close(()=>r()));});beforeEach(()=>{active=true;fileRequests=0;});
async function request(token?:string,query=`transaction=${id}`){let code=200;const headers:Record<string,string>={};let bytes=0;const response:ApiResponse={status(n){code=n;return response;},setHeader(n,v){headers[n.toLowerCase()]=String(v);},json(){},end(body){bytes+=body?.byteLength??0;},write(body){bytes+=body.byteLength;return true;}};await handler({method:'GET',url:'/api/files/read?'+query,headers:token?{authorization:'Bearer '+token}:{}},response);return{code,headers,bytes};}
it('streams an authenticated file without an independently reusable signed URL',async()=>{const r=await request('fixture-token');expect(r.code).toBe(200);expect(r.bytes).toBe(3);expect(r.headers['cache-control']).toContain('no-store');expect(r.headers.location).toBeUndefined();});
it('denies a revoked session before reading Storage',async()=>{active=false;expect((await request('revoked-token')).code).toBe(401);expect(fileRequests).toBe(0);});
it('denies missing authorization and token-in-query requests',async()=>{expect((await request()).code).toBe(401);expect((await request(undefined,'token=fixture-token&transaction='+id)).code).toBe(401);});
it('rejects path/traversal parameters rather than serving arbitrary files',async()=>expect((await request('fixture-token','transaction=../../secret')).code).toBe(400));
