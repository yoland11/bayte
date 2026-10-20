import {createClient} from '@supabase/supabase-js';
import {verifyEnvironment} from '../_lib/environment.js';
import {CANONICAL_USER_ID,env,noStore,type ApiRequest,type ApiResponse} from '../_lib/auth.js';
const PROJECT='4324284c-2650-4eaa-86bd-152fbd1e8c2e';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(request:ApiRequest,response:ApiResponse):Promise<void>{
  noStore(response);response.setHeader('Vary','Authorization');response.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
  if(request.method!=='GET'){response.setHeader('Allow','GET');response.status(405).end();return;}
  const bearer=typeof request.headers.authorization==='string'?/^Bearer ([^\s]+)$/.exec(request.headers.authorization)?.[1]:null;
  if(!bearer){response.status(401).end();return;}
  const params=new URL(request.url??'', 'http://internal').searchParams;
  const transaction=params.get('transaction'),logo=params.get('logo')==='1';
  if((!logo&&!uuid.test(transaction??''))||(logo&&transaction)||[...params.keys()].some(k=>!['transaction','logo'].includes(k))){response.status(400).end();return;}
  try{
    await verifyEnvironment();
    const client=createClient(process.env.SUPABASE_URL?.trim()||env('VITE_SUPABASE_URL'),process.env.SUPABASE_PUBLISHABLE_KEY?.trim()||env('VITE_SUPABASE_PUBLISHABLE_KEY'),{global:{headers:{Authorization:'Bearer '+bearer}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
    const identity=await client.auth.getUser(bearer);
    const live=await client.rpc('beity_session_active');
    if(identity.error||identity.data.user?.id!==CANONICAL_USER_ID||live.error||live.data!==true){response.status(401).end();return;}
    let path:string,fileType:string;
    if(logo){const r=await client.from('projects').select('logo_path').eq('id',PROJECT).eq('user_id',CANONICAL_USER_ID).single();if(r.error||!r.data?.logo_path){response.status(404).end();return;}path=r.data.logo_path;fileType='image/'+(path.endsWith('.svg')?'svg+xml':path.split('.').pop());}
    else{const r=await client.from('attachments').select('file_path,file_name,file_type').eq('transaction_id',transaction!).eq('project_id',PROJECT).eq('user_id',CANONICAL_USER_ID).single();if(r.error||!r.data){response.status(404).end();return;}path=r.data.file_path;fileType=r.data.file_type;}
    if(!['image/jpeg','image/jpg','image/png','image/webp','image/svg+xml','application/pdf'].includes(fileType)){response.status(403).end();return;}
    if(!path.startsWith(`${CANONICAL_USER_ID}/${PROJECT}/`)||path.split('/').includes('..')){response.status(403).end();return;}
    const file=await client.storage.from(logo?'project-assets':'transaction-attachments').download(path);
    if(file.error||!file.data){response.status(404).end();return;}
    // Recheck after the remote read, before any bytes leave this process.
    const stillLive=await client.rpc('beity_session_active');
    if(stillLive.error||stillLive.data!==true){response.status(401).end();return;}
    response.setHeader('Content-Type',fileType);response.setHeader('Content-Disposition','inline');response.status(200);
    const reader=file.data.stream().getReader();
    if(response.write){for(;;){const part=await reader.read();if(part.done)break;response.write(part.value);}response.end();}
    else response.end(new Uint8Array(await file.data.arrayBuffer()));
  }catch{response.status(503).end();}
}
