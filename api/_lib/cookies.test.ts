import { afterAll, beforeAll, expect, it, vi } from 'vitest';
let auth: typeof import('./auth');
beforeAll(async () => { vi.stubEnv('VERCEL_ENV', 'production'); vi.resetModules(); auth = await import('./auth'); });
afterAll(() => vi.unstubAllEnvs());
it('sets a production host-only HttpOnly Secure strict-samesite cookie', () => {
  const headers = new Map<string, string>();
  auth.setSessionCookie({ setHeader: (key, value) => headers.set(key, String(value)) } as Parameters<typeof auth.setSessionCookie>[0], 'fixture-only-refresh');
  const cookie = headers.get('Set-Cookie')!;
  expect(cookie).toContain('__Host-beity-session='); expect(cookie).toContain('; Secure');
  expect(cookie).toContain('; HttpOnly'); expect(cookie).toContain('; SameSite=Strict'); expect(cookie).toContain('; Path=/');
  expect(cookie).not.toContain('Domain=');
});
it('expires the same production cookie on logout', () => {
  const headers = new Map<string, string>();
  auth.clearSessionCookie({ setHeader: (key, value) => headers.set(key, String(value)) } as Parameters<typeof auth.clearSessionCookie>[0]);
  expect(headers.get('Set-Cookie')).toContain('__Host-beity-session=;');
  expect(headers.get('Set-Cookie')).toContain('Max-Age=0; Secure');
});
