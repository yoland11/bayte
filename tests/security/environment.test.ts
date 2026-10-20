import {describe,it,expect} from 'vitest';
import {assertEnvironment} from '../../api/_lib/environment.js';
const prod='irnwbayhxawphkxmbnbx',stage='kwuhkahuhacemmgbgffw';
const key=(ref:string,role='anon')=>`e30.${Buffer.from(JSON.stringify({ref,role})).toString('base64url')}.test`;
const env=(ref=prod)=>({VERCEL_ENV:'production',SUPABASE_URL:`https://${ref}.supabase.co`,VITE_SUPABASE_URL:`https://${ref}.supabase.co`,SUPABASE_PUBLISHABLE_KEY:key(ref),VITE_SUPABASE_PUBLISHABLE_KEY:key(ref),SUPABASE_SERVICE_ROLE_KEY:key(ref,'service_role')});
describe('server production allowlist',()=>{
 it('accepts the exact production project',()=>expect(()=>assertEnvironment(env())).not.toThrow());
 it('rejects a complete staging configuration in production',()=>expect(()=>assertEnvironment(env(stage))).toThrow());
 it('rejects a staging server secret with production public settings',()=>expect(()=>assertEnvironment({...env(),SUPABASE_SERVICE_ROLE_KEY:key(stage,'service_role')})).toThrow());
 it('rejects mixed frontend/server project configuration',()=>expect(()=>assertEnvironment({...env(),VITE_SUPABASE_URL:`https://${stage}.supabase.co`})).toThrow());
 it('rejects privileged public credentials',()=>expect(()=>assertEnvironment({...env(),VITE_SUPABASE_PUBLISHABLE_KEY:key(prod,'service_role')})).toThrow());
 it('does not permit test/development bypass on Vercel production',()=>expect(()=>assertEnvironment({...env(stage),NODE_ENV:'test'})).toThrow());
 it('accepts staging in Preview and rejects production in Preview',()=>{expect(()=>assertEnvironment({...env(stage),VERCEL_ENV:'preview'})).not.toThrow();expect(()=>assertEnvironment({...env(),VERCEL_ENV:'preview'})).toThrow();});
 it('rejects unknown Vercel targets and noncanonical URL forms',()=>{expect(()=>assertEnvironment({...env(),VERCEL_ENV:'other'})).toThrow();expect(()=>assertEnvironment({...env(),SUPABASE_URL:`https://${prod}.supabase.co/evil`})).toThrow();});
});

import {verifyEnvironment} from '../../api/_lib/environment.js';
it('refuses opaque keys rejected by the allowlisted production gateway',async()=>{
 const configuration={...env(),SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture'};
 await expect(verifyEnvironment(configuration,async()=>new Response(null,{status:401}))).rejects.toThrow();
});
it('verifies accepted key bindings without putting keys in request URLs',async()=>{
 const configuration={...env(),SUPABASE_SERVICE_ROLE_KEY:'sb_secret_fixture'};let count=0;
 await expect(verifyEnvironment(configuration,async(input,init)=>{count++;expect(String(input)).toMatch(/^https:\/\/irnwbayhxawphkxmbnbx\.supabase\.co\//);expect(String(input)).not.toContain('sb_secret');expect(new Headers(init?.headers).has('apikey')).toBe(true);return new Response('[]',{status:200});})).resolves.toBeUndefined();expect(count).toBeGreaterThan(0);
});
it('rejects conflicting explicit Supabase refs or canonical workspace identifiers',()=>{
 expect(()=>assertEnvironment({...env(),SUPABASE_PROJECT_REF:stage})).toThrow();
 expect(()=>assertEnvironment({...env(),BEITY_CANONICAL_PROJECT_ID:'00000000-0000-4000-8000-000000000001'})).toThrow();
});
