export const PRODUCTION_PROJECT_REFS = ['irnwbayhxawphkxmbnbx'] as const;
export const STAGING_PROJECT_REF = 'kwuhkahuhacemmgbgffw';
type Values = Record<string, string | undefined>;
export function assertEnvironment(values: Values = process.env): void {
  const target = values.VERCEL_ENV || (values.NODE_ENV === 'production' ? 'production' : 'development');
  if (!['production', 'preview', 'development'].includes(target)) throw new Error('Invalid deployment environment');
  const server = values.SUPABASE_URL?.trim() || values.VITE_SUPABASE_URL?.trim();
  const browser = values.VITE_SUPABASE_URL?.trim() || server;
  const ref = (value?: string) => {
    if (!value) throw new Error('Missing project configuration');
    const url = new URL(value);
    if (target === 'development' && values.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return 'isolated-test';
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid project URL');
    const match = /^([a-z]{20})\.supabase\.co$/.exec(url.hostname);
    if (!match) throw new Error('Invalid project host');
    return match[1];
  };
  const project = ref(server);
  for(const name of ['SUPABASE_PROJECT_REF','VITE_SUPABASE_PROJECT_REF','BEITY_SUPABASE_PROJECT_REF'])if(values[name]&&values[name]!==project)throw Error('Explicit project ref refused');
  if(values.BEITY_CANONICAL_PROJECT_ID&&values.BEITY_CANONICAL_PROJECT_ID!=='4324284c-2650-4eaa-86bd-152fbd1e8c2e')throw Error('Canonical workspace refused');
  if(values.BEITY_CANONICAL_USER_ID&&values.BEITY_CANONICAL_USER_ID!=='e4afb7c8-0915-4b5f-8805-66c292a5d3b6')throw Error('Canonical user refused');
  if (project !== ref(browser)) throw new Error('Project configuration mismatch');
  if (target === 'production' && !(PRODUCTION_PROJECT_REFS as readonly string[]).includes(project)) throw new Error('Production project refused');
  if (target === 'preview' && project !== STAGING_PROJECT_REF) throw new Error('Preview project refused');
  for (const [name, role] of [['SUPABASE_SERVICE_ROLE_KEY', 'service_role'], ['SUPABASE_PUBLISHABLE_KEY', 'anon'], ['VITE_SUPABASE_PUBLISHABLE_KEY', 'anon']] as const) {
    const key = values[name]?.trim();
    if (!key) continue; // Required-key handling remains in env(), without printing values.
    if (key.split('.').length === 3) {
      let payload: { ref?: string; role?: string };
      try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
      catch { throw new Error('Invalid key configuration'); }
      if (payload.ref !== project || payload.role !== role) throw new Error('Key project/role refused');
    } else if (name.startsWith('VITE_') && key.startsWith('sb_secret_')) throw new Error('Privileged public configuration refused');
  }
  if (values.SUPABASE_PUBLISHABLE_KEY && values.VITE_SUPABASE_PUBLISHABLE_KEY && values.SUPABASE_PUBLISHABLE_KEY !== values.VITE_SUPABASE_PUBLISHABLE_KEY) throw new Error('Public key configuration mismatch');
}

const verifiedBindings = new Map<string,number>();
export async function verifyEnvironment(values:Values=process.env,fetcher:typeof fetch=fetch):Promise<void>{
  assertEnvironment(values);
  const target=values.VERCEL_ENV||(values.NODE_ENV==='production'?'production':'development');
  if(target!=='production')return;
  const url=values.SUPABASE_URL?.trim()||values.VITE_SUPABASE_URL?.trim();
  const publicKey=values.SUPABASE_PUBLISHABLE_KEY?.trim()||values.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  const serviceKey=values.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if(!publicKey||!serviceKey)throw Error('Production key configuration missing');
  const fingerprint=url+'|'+publicKey+'|'+serviceKey;
  if(fetcher===fetch&&(verifiedBindings.get(fingerprint)??0)>Date.now())return;
  for(const [key,path] of [[publicKey,'/auth/v1/settings'],[serviceKey,'/rest/v1/projects?select=id&limit=0']]){
    const response=await fetcher(url+path,{headers:{apikey:key,authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(5000)});
    if(!response.ok)throw Error('Production key binding refused');
    await response.arrayBuffer();
  }
  if(fetcher===fetch){verifiedBindings.clear();verifiedBindings.set(fingerprint,Date.now()+60_000);}
}
