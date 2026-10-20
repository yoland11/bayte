import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import argon2 from '@node-rs/argon2';
import login from '../../api/pin/login.js';
import restore from '../../api/pin/session.js';
import logout from '../../api/pin/logout.js';
import { CANONICAL_USER_ID, SESSION_COOKIE, type ApiRequest, type ApiResponse } from '../../api/_lib/auth.js';
import { createPinSession } from '../../src/lib/pinSession';

// Real handlers + real Supabase SDK + real Argon2; only GoTrue/REST are isolated HTTP fixtures.
const sessions = new Map<string, { access: string; refresh: string }>();
const budgets = new Map<string, number>();
const proofs=new Set<string>();let proofRequests=0;
let server: Server;
let base: string;
const samplePin = '826491';
beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const reply = (status: number, data: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
    const url = new URL(req.url!, 'http://fixture');
    if (url.pathname.endsWith('/rpc/beity_reserve_pin_attempt')) {
      const count = budgets.get(body.p_identifier_hash) ?? 0; budgets.set(body.p_identifier_hash, count + 1); reply(200, count < 5); return;
    }
    if(url.pathname.endsWith('/admin/users/'+CANONICAL_USER_ID)){reply(200,{id:CANONICAL_USER_ID,email:'fixture@example.invalid',email_confirmed_at:'2026-10-20',is_anonymous:false});return;}
    if(url.pathname.endsWith('/admin/generate_link')){proofRequests++;if(body.type!=='recovery'){reply(400,{message:'existing user only'});return;}const proof=randomUUID();proofs.add(proof);reply(200,{id:CANONICAL_USER_ID,hashed_token:proof,verification_type:'recovery'});return;}
    if(url.pathname.endsWith('/verify')){if(body.type!=='recovery'||!proofs.delete(body.token_hash)){reply(403,{code:'otp_expired',message:'expired'});return;}const id=randomUUID(),session={access:`fixture-access-${id}`,refresh:`fixture-refresh-${id}`};sessions.set(id,session);reply(200,{access_token:session.access,refresh_token:session.refresh,token_type:'bearer',expires_in:3600,user:{id:CANONICAL_USER_ID}});return;}
    if (url.pathname.endsWith('/token')) {
      let id: string;
      if (url.searchParams.get('grant_type') === 'password') {
        id = randomUUID(); sessions.set(id, { access: `fixture-access-${id}`, refresh: `fixture-refresh-${id}` });
      } else {
        const match = [...sessions.entries()].find(([, s]) => s.refresh === body.refresh_token);
        if (!match) { reply(400, { error: 'invalid_grant', error_description: 'fixture revoked session' }); return; }
        id = match[0];
      }
      const session = sessions.get(id)!;
      reply(200, { access_token: session.access, refresh_token: session.refresh, token_type: 'bearer', expires_in: 3600, user: { id: CANONICAL_USER_ID } }); return;
    }
    const token = req.headers.authorization?.replace('Bearer ', '');
    const current = [...sessions.entries()].find(([, s]) => s.access === token);
    if (url.pathname.endsWith('/user')) { reply(current ? 200 : 401, current ? { id: CANONICAL_USER_ID } : { message: 'revoked' }); return; }
    if (url.pathname.endsWith('/logout')) {
      if (url.searchParams.get('scope') !== 'local') { reply(400, { message: 'must not revoke other devices' }); return; }
      if (current) sessions.delete(current[0]);
      res.writeHead(204); res.end(); return;
    }
    reply(404, { message: 'unexpected fixture endpoint' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('fixture did not start');
  base = `http://127.0.0.1:${address.port}`;
  vi.stubEnv('SUPABASE_URL', base); vi.stubEnv('VITE_SUPABASE_URL', base);
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'isolated-public'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'isolated-public'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated-server');
  vi.stubEnv('BEITY_RATE_LIMIT_SECRET', 'isolated-rate-secret'); vi.stubEnv('BEITY_CANONICAL_EMAIL', 'fixture@example.invalid'); vi.stubEnv('BEITY_CANONICAL_PASSWORD', 'isolated-only');
  vi.stubEnv('BEITY_PIN_ARGON2_HASH', await argon2.hash(samplePin, { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 }));
});
beforeEach(() => { sessions.clear(); budgets.clear(); proofs.clear();proofRequests=0;vi.stubEnv('BEITY_SESSION_ISSUER','password');vi.stubEnv('BEITY_CANONICAL_PASSWORD','isolated-only'); });
afterAll(async () => { vi.unstubAllEnvs(); await new Promise<void>((resolve) => server.close(() => resolve())); });
function device(ip: string) {
  let cookie = '';
  const fetcher = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const route = String(url).endsWith('/login') ? login : String(url).endsWith('/logout') ? logout : restore;
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const request: ApiRequest = { method: init?.method, headers: { ...headers, host: 'beity.test', origin: 'https://beity.test', 'x-real-ip': ip, cookie }, body: init?.body ? String(init.body) : undefined };
    let status = 200; const outgoing = new Headers(); let body: unknown;
    const response: ApiResponse = { status(code) { status = code; return response; }, setHeader(name, value) { outgoing.set(name, String(value)); }, json(value) { body = value; }, end() {} };
    await route(request, response);
    const setCookie = outgoing.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: outgoing });
  };
  return { client: createPinSession(fetcher, null), fetcher, cookie: () => cookie };
}
describe('PIN API and session integration over isolated Auth HTTP', () => {
  it('restores persistent sessions and revokes only the locked device', async () => {
    const phone = device('192.0.2.1'), desktop = device('198.51.100.1');
    await phone.client.login(samplePin); await desktop.client.login(samplePin);
    const originalCookie = phone.cookie();
    expect(originalCookie.startsWith(SESSION_COOKIE + '=')).toBe(true);
    await expect(phone.client.restore()).resolves.toBe(true);
    expect(sessions.size).toBe(2);
    await phone.client.lock();
    expect(sessions.size).toBe(1);
    await expect(phone.client.restore()).resolves.toBe(false);
    await expect(desktop.client.restore()).resolves.toBe(true);
  });
  it('rejects a replay of the revoked refresh cookie', async () => {
    const phone = device('192.0.2.1'); await phone.client.login(samplePin);
    const oldCookie = phone.cookie(); await phone.client.lock();
    let code = 0;
    const response: ApiResponse = { status(value) { code = value; return response; }, setHeader() {}, json() {}, end() {} };
    await restore({ method: 'GET', headers: { cookie: oldCookie } }, response);
    expect(code).toBe(401);
  });
  it('admits no more than five concurrent invalid PIN verifications for one address', async () => {
    const phone = device('192.0.2.1');
    const replies = await Promise.all(Array.from({ length: 24 }, () => phone.fetcher('/api/pin/login', { method: 'POST', body: JSON.stringify({ pin: '000000' }) })));
    expect(replies.filter((r) => r.status === 401)).toHaveLength(5);
    expect(replies.filter((r) => r.status === 429)).toHaveLength(19);
    expect(sessions.size).toBe(0);
    await expect(device('198.51.100.1').client.login(samplePin)).resolves.toBeUndefined();
  });
});

describe('server-controlled session issuer',()=>{
 it('authenticates independent PIN devices without generating exchange proofs',async()=>{
  vi.stubEnv('BEITY_SESSION_ISSUER','server_password');
  const one=device('192.0.2.11'),two=device('192.0.2.12');await one.client.login(samplePin);await two.client.login(samplePin);expect(proofRequests).toBe(0);expect(sessions.size).toBe(2);await one.client.lock();await expect(two.client.restore()).resolves.toBe(true);
 });
 it('rejects the retired bearer-proof issuer even when a server password is configured',async()=>{vi.stubEnv('BEITY_SESSION_ISSUER','existing_user_otp');const r=await device('192.0.2.20').fetcher('/api/pin/login',{method:'POST',body:JSON.stringify({pin:samplePin})});expect(r.status).toBe(503);expect(proofRequests).toBe(0);expect(sessions.size).toBe(0);});
 it('fails closed for an unknown issuer without silently falling back',async()=>{vi.stubEnv('BEITY_SESSION_ISSUER','typo');const r=await device('192.0.2.21').fetcher('/api/pin/login',{method:'POST',body:JSON.stringify({pin:samplePin})});expect(r.status).toBe(503);expect(sessions.size).toBe(0);expect(proofRequests).toBe(0);});
 it('fails closed when the server credential is absent',async()=>{vi.stubEnv('BEITY_SESSION_ISSUER','server_password');vi.stubEnv('BEITY_CANONICAL_PASSWORD','');const r=await device('192.0.2.22').fetcher('/api/pin/login',{method:'POST',body:JSON.stringify({pin:samplePin})});expect(r.status).toBe(503);expect(sessions.size).toBe(0);expect(proofRequests).toBe(0);});
});
