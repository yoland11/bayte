import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ valid: true, fail: false, revoked: [] as string[] }));
vi.mock('../../api/_lib/auth.js', async (original) => ({ ...await original<typeof import('../../api/_lib/auth.js')>(), getAuthClient: () => ({ auth: {
  getUser: async () => ({ data: { user: { id: 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6' } }, error: null }),
  refreshSession: async () => auth.fail ? { data: {}, error: { status: 503 } } : auth.valid ? { data: { user: { id: 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6' }, session: { access_token: 'fixture-session-one' } }, error: null } : { data: {}, error: { status: 400 } },
  admin: { signOut: async (jwt: string, scope: string) => { if (scope !== 'local') throw Error('must not revoke other devices'); auth.revoked.push(jwt); auth.valid = false; return { error: null }; } }
} }) }));
import logout from '../../api/pin/logout.js';
import { SESSION_COOKIE, type ApiResponse } from '../../api/_lib/auth.js';
const response = () => { const r = { code: 0, headers: {} as Record<string, string | string[]>, body: null as unknown, status(code: number) { r.code = code; return r; }, setHeader(k: string, v: string | string[]) { r.headers[k] = v; }, json(v: unknown) { r.body = v; }, end() {} }; return r; };
const request = () => ({ method: 'POST', headers: { host: 'localhost:5173', origin: 'http://localhost:5173', cookie: `${SESSION_COOKIE}=isolated-refresh` } });
beforeEach(() => { auth.valid = true; auth.fail = false; auth.revoked = []; });
describe('device logout API', () => {
  it('revokes only this device session and clears its cookie', async () => {
    const res = response(); await logout(request(), res as ApiResponse);
    expect(res.code).toBe(204); expect(auth.valid).toBe(false); expect(auth.revoked).toHaveLength(1);
    expect(res.headers['Set-Cookie']).toContain('Max-Age=0');
  });
  it('treats an already revoked refresh token as an idempotent logout', async () => {
    auth.valid = false; const res = response(); await logout(request(), res);
    expect(res.code).toBe(204);
  });
  it('revokes the access-token session even if its browser cookie was removed', async () => {
    const res = response();
    await logout({ method: 'POST', headers: { host: 'localhost:5173', origin: 'http://localhost:5173', authorization: 'Bearer isolated-access' } }, res);
    expect(res.code).toBe(204); expect(auth.valid).toBe(false);
  });
  it('rejects cross-origin logout without revoking any device', async () => {
    const res = response(); await logout({ ...request(), headers: { ...request().headers, origin: 'https://foreign.invalid' } }, res);
    expect(res.code).toBe(403); expect(auth.revoked).toHaveLength(0);
  });
  it('does not claim success during an Auth outage', async () => {
    auth.fail = true; const res = response(); await logout(request(), res);
    expect(res.code).toBe(503); expect(auth.valid).toBe(true);
  });
});
