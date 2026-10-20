import { describe, expect, it, vi } from 'vitest';
import { createPinSession } from './pinSession';

it('does not treat a static maintenance HTML response as server-side logout confirmation',async()=>{
 const entries=new Map<string,string>();const storage={getItem:(k:string)=>entries.get(k)??null,setItem:(k:string,v:string)=>{entries.set(k,v);},removeItem:(k:string)=>{entries.delete(k);}};
 let maintenance=true,sessionReads=0;
 const session=createPinSession(async url=>{
  if(String(url).endsWith('/logout'))return maintenance?new Response('<html>maintenance</html>',{status:200,headers:{'content-type':'text/html'}}):new Response(null,{status:204});
  if(String(url).endsWith('/session'))sessionReads++;
  return new Response(JSON.stringify({accessToken:'isolated-fixture'}));
 },storage);
 await session.login('826491');await expect(session.lock()).rejects.toThrow('session-lock-unavailable');
 expect(session.accessToken()).toBeNull();expect(entries.get('beity-session-revocation-pending')).toBe('1');
 await expect(session.restore()).rejects.toThrow();expect(sessionReads).toBe(0);
 maintenance=false;expect(await session.restore()).toBe(false);expect(entries.size).toBe(0);
});

describe('PIN session client', () => {
  it('keeps the server-issued access token in memory after PIN verification', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: 'short-lived-access-token' }), { status: 200 }));
    const session = createPinSession(fetcher);

    await session.login('724683');

    expect(fetcher).toHaveBeenCalledWith('/api/pin/login', expect.objectContaining({ method: 'POST' }));
    expect(session.accessToken()).toBe('short-lived-access-token');
  });

  it('restores an existing device session without persisting tokens in browser storage', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ accessToken: 'restored-token' }), { status: 200 }));
    const session = createPinSession(fetcher);

    await expect(session.restore()).resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith('/api/pin/session', expect.objectContaining({ credentials: 'same-origin' }));
    expect(session.accessToken()).toBe('restored-token');
  });

  it('clears the in-memory token when the server session is unavailable', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'old-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const session = createPinSession(fetcher);

    await session.login('724683');
    await expect(session.restore()).resolves.toBe(false);

    expect(session.accessToken()).toBeNull();
  });

  it('keeps the current access token on a transient refresh failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ accessToken: 'current-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const session = createPinSession(fetcher);

    await session.login('724683');
    await expect(session.restore()).rejects.toThrow('session-unavailable');

    expect(session.accessToken()).toBe('current-token');
  });

  it('does not accept a PIN when the server rejects it', async () => {
    const session = createPinSession(vi.fn().mockResolvedValue(new Response(null, { status: 401 })));

    await expect(session.login('0000')).rejects.toThrow('pin-invalid');
    expect(session.accessToken()).toBeNull();
  });

  it('reports centralized rate limiting separately from an incorrect PIN', async () => {
    const session = createPinSession(vi.fn().mockResolvedValue(new Response(null, { status: 429 })));

    await expect(session.login('724683')).rejects.toThrow('pin-rate-limited');
  });

  it('does not label a server configuration failure as an incorrect PIN', async () => {
    const session = createPinSession(vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    await expect(session.login('724683')).rejects.toThrow('pin-unavailable');
  });
});

describe('persistent device lock', () => {
  it('revokes the server session before completing a lock', async () => {
    let valid = true;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/logout')) { valid = false; return new Response(null, { status: 204 }); }
      return valid ? new Response(JSON.stringify({ accessToken: 'fixture' }), { status: 200 }) : new Response(null, { status: 401 });
    });
    const session = createPinSession(fetcher);
    await session.login('724683');
    await session.lock();
    expect(session.accessToken()).toBeNull();
    await expect(session.restore()).resolves.toBe(false);
  });
  it('does not silently report successful revocation when the server is offline', async () => {
    const session = createPinSession(vi.fn().mockRejectedValue(new Error('offline')));
    await expect(session.lock()).rejects.toThrow('session-lock-unavailable');
  });
});

it('ignores a late refresh response after a lock starts', async () => {
  let complete!: (response: Response) => void;
  const fetcher = vi.fn((url: RequestInfo | URL) => String(url).endsWith('/logout')
    ? Promise.resolve(new Response(null, { status: 204 }))
    : new Promise<Response>((resolve) => { complete = resolve; }));
  const session = createPinSession(fetcher);
  const restoring = session.restore();
  await vi.waitFor(() => expect(complete).toBeDefined());
  const locking = session.lock();
  complete(new Response(JSON.stringify({ accessToken: 'late-token' }), { status: 200 }));
  await expect(restoring).resolves.toBe(false);
  await locking;
  expect(session.accessToken()).toBeNull();
});

it('persists only a lock intent and retries revocation before restore after a reload', async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const first = createPinSession(vi.fn().mockRejectedValue(new Error('offline')), storage);
  await expect(first.lock()).rejects.toThrow();
  expect([...values.values()]).toEqual(['1']);
  let revoked = false;
  const reloaded = createPinSession(async (url) => {
    if (!String(url).endsWith('/logout')) throw new Error('must not restore an unrevoked session');
    revoked = true; return new Response(null, { status: 204 });
  }, storage);
  await expect(reloaded.restore()).resolves.toBe(false);
  expect(revoked).toBe(true); expect(values.size).toBe(0);
});

it('does not reopen the UI from a late login response after lock was requested', async () => {
  let complete!: (response: Response) => void;
  const session = createPinSession((url) => String(url).endsWith('/logout')
    ? Promise.resolve(new Response(null, { status: 204 }))
    : new Promise<Response>((resolve) => { complete = resolve; }), null);
  const login = session.login('826491');
  const rejected = expect(login).rejects.toThrow('session-locked');
  await vi.waitFor(() => expect(complete).toBeDefined());
  const locking = session.lock();
  complete(new Response(JSON.stringify({ accessToken: 'late-fixture' }), { status: 200 }));
  await rejected; await locking;
  expect(session.accessToken()).toBeNull();
});

it('does not revoke a fresh shared-browser session after another tab finished the pending logout', async () => {
  const target = new EventTarget(); vi.stubGlobal('window', target);
  try {
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
    let unexpectedLogout = false;
    const session = createPinSession(async (url) => {
      if (String(url).endsWith('/logout')) { unexpectedLogout = true; return new Response(null, { status: 204 }); }
      return new Response(JSON.stringify({ accessToken: 'fresh-fixture' }), { status: 200 });
    }, storage);
    const unsubscribe = session.onLock(() => {});
    await session.login('826491');
    entries.set('beity-session-revocation-pending', '1');
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'beity-session-revocation-pending', newValue: '1' }));
    expect(session.accessToken()).toBeNull();
    entries.clear();
    target.dispatchEvent(Object.assign(new Event('storage'), { key: 'beity-session-revocation-pending', newValue: null }));
    await session.login('826491');
    expect(unexpectedLogout).toBe(false); unsubscribe();
  } finally { vi.unstubAllGlobals(); }
});

describe('authenticated token lifecycle', () => {
  it('publishes login and refresh tokens, then invalidates observers on server expiration', async () => {
    const responses = [new Response(JSON.stringify({ accessToken: 'login-fixture' })), new Response(JSON.stringify({ accessToken: 'refreshed-fixture' })), new Response(null, { status: 401 })];
    const session = createPinSession(async () => responses.shift()!, null);
    const values: Array<string | null> = []; let locked = false;
    const unsubscribe = session.onTokenChange(value => values.push(value));
    session.onLock(() => { locked = true; });
    await session.login('826491'); await session.restore(); await session.restore();
    expect(values).toEqual(['login-fixture', 'refreshed-fixture', null]);
    expect(locked).toBe(true); unsubscribe();
  });
  it('notifies token observers immediately when a local lock begins, even offline', async () => {
    const session = createPinSession(async url => String(url).endsWith('/logout') ? Promise.reject(Error('offline')) : new Response(JSON.stringify({ accessToken: 'fixture' })), null);
    const values: Array<string | null> = []; session.onTokenChange(value => values.push(value));
    await session.login('826491'); const lock = session.lock();
    expect(values).toEqual(['fixture', null]); await expect(lock).rejects.toThrow();
  });
  it('does not expose an expired JWT as a current authenticated token', async () => {
    const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url')}.fixture`;
    const session = createPinSession(async () => new Response(JSON.stringify({ accessToken: token })), null);
    await session.login('826491'); expect(session.accessToken()).toBeNull();
  });
});
