import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPinSession } from './pinSession';
import { createWorkspaceRealtime, type RealtimeTransport } from './workspaceRealtime';

const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); };
function setup() {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
  let online = true, serverValid = true, unavailable = false, nextToken = 'authenticated-one';
  const requests: string[] = [], events = new EventTarget(), snapshots: string[] = [];
  const session = createPinSession(async path => {
    requests.push(String(path));
    if (String(path).endsWith('/logout')) { serverValid = false; return new Response(null, { status: 204 }); }
    if (unavailable) return new Response(null, { status: 503 });
    return serverValid ? new Response(JSON.stringify({ accessToken: nextToken })) : new Response(null, { status: 401 });
  }, null);
  let authenticated = 'public-anon', pendingAuth: Promise<void> | null = null;
  const channels: Array<{ open: boolean; token: string; event: () => void; status: (value: string) => void }> = [];
  const transport: RealtimeTransport = {
    async authenticate(token) { if (pendingAuth) await pendingAuth; authenticated = token; },
    subscribe(event, status) {
      const channel = { open: true, token: authenticated, event, status }; channels.push(channel);
      queueMicrotask(() => status('SUBSCRIBED'));
      return { async remove() { channel.open = false; } };
    },
    disconnect() { channels.forEach(c => { c.open = false; }); }
  };
  let serverValue = 'first';
  const refresh = vi.fn(async (current: () => boolean) => { if (current()) snapshots.push(serverValue); });
  const manager = createWorkspaceRealtime({ transport, session, refetch: refresh, environment: { events, isOnline: () => online } });
  return { session, manager, channels, snapshots, refresh, requests,
    setToken(value: string) { nextToken = value; }, setValid(value: boolean) { serverValid = value; }, setUnavailable(value: boolean) { unavailable = value; },
    setAuthPending(value: Promise<void>) { pendingAuth = value; },
    setOnline(value: boolean) { online = value; events.dispatchEvent(new Event(value ? 'online' : 'offline')); },
    setServerValue(value: string) { serverValue = value; },
    deliver() { for (const c of channels) if (c.open && c.token === nextToken) c.event(); },
    open() { return channels.filter(c => c.open); }
  };
}
afterEach(() => vi.useRealTimers());
describe('protected workspace Realtime lifecycle', () => {
  it('never subscribes before PIN login, then applies authenticated token before the join', async () => {
    const f = setup(); f.manager.start(); await flush(); expect(f.channels).toHaveLength(0);
    await f.session.login('826491'); await flush();
    expect(f.open()).toHaveLength(1); expect(f.open()[0].token).toBe('authenticated-one');
    f.setServerValue('changed'); f.deliver(); await vi.advanceTimersByTimeAsync(300);
    expect(f.snapshots[f.snapshots.length - 1]).toBe('changed'); f.manager.stop();
  });
  it('waits for token application and ignores a late authentication completion after lock', async () => {
    const f = setup(); let done!: () => void; f.setAuthPending(new Promise(resolve => { done = resolve; }));
    await f.session.login('826491'); f.manager.start(); await flush(); expect(f.channels).toHaveLength(0);
    await f.session.lock(); done(); await flush(); expect(f.open()).toHaveLength(0); f.manager.stop();
  });
  it('replaces token-bound subscriptions after refresh and rejects old queued events', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush();
    const old = f.open()[0]; f.setToken('authenticated-two'); await f.session.restore(); await flush();
    expect(f.open()).toHaveLength(1); expect(f.open()[0].token).toBe('authenticated-two');
    const count = f.snapshots.length; old.event(); await vi.advanceTimersByTimeAsync(300); expect(f.snapshots).toHaveLength(count);
    f.manager.stop();
  });
  it('invalidates callbacks immediately on lock and removes channels without waiting for unmount', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush(); const old = f.open()[0];
    const locking = f.session.lock(); old.event(); await locking; await flush(); const count = f.snapshots.length;
    old.event(); await vi.advanceTimersByTimeAsync(300); expect(f.snapshots).toHaveLength(count); expect(f.open()).toHaveLength(0); f.manager.stop();
  });
  it('revalidates after offline, resubscribes once and refetches changes missed offline', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush();
    f.setOnline(false); await flush(); expect(f.open()).toHaveLength(0);
    f.setServerValue('written-while-offline'); f.setToken('reconnected-token'); f.setOnline(true); f.setOnline(true); await flush();
    expect(f.requests.filter(x => x.endsWith('/session'))).toHaveLength(1);
    expect(f.open()).toHaveLength(1); expect(f.open()[0].token).toBe('reconnected-token');
    expect(f.snapshots[f.snapshots.length - 1]).toBe('written-while-offline'); f.manager.stop();
  });
  it('never reconnects a revoked session', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush();
    f.setOnline(false); f.setValid(false); f.setOnline(true); await flush();
    expect(f.session.accessToken()).toBeNull(); expect(f.open()).toHaveLength(0); f.manager.stop();
  });
  it('drops a JWT at its expiry boundary and does not deliver events if refresh is rejected', async () => {
    const f = setup(); f.setToken(`e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 2 })).toString('base64url')}.fixture`);
    await f.session.login('826491'); f.manager.start(); await flush(); const old = f.open()[0]; f.setValid(false);
    await vi.advanceTimersByTimeAsync(2001); await flush(); const count = f.snapshots.length; old.event();
    await vi.advanceTimersByTimeAsync(300); expect(f.open()).toHaveLength(0); expect(f.snapshots).toHaveLength(count); expect(f.session.accessToken()).toBeNull(); f.manager.stop();
  });
  it('revalidates periodically so server revocation closes an otherwise idle connection', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush(); f.setValid(false);
    await vi.advanceTimersByTimeAsync(60001); await flush(); expect(f.open()).toHaveLength(0); expect(f.session.accessToken()).toBeNull(); f.manager.stop();
  });
  it('recovers from channel errors with fresh server authentication, without duplicate retries', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush(); const old = f.open()[0];
    old.status('CHANNEL_ERROR'); old.status('TIMED_OUT'); await vi.advanceTimersByTimeAsync(1100); await flush();
    expect(f.open()).toHaveLength(1); expect(f.requests.filter(x => x.endsWith('/session'))).toHaveLength(1); f.manager.stop();
  });
  it('start is idempotent and stop unregisters listeners and invalidates pending data reads', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); f.manager.start(); await flush(); expect(f.open()).toHaveLength(1);
    const guard = f.refresh.mock.calls[f.refresh.mock.calls.length - 1][0]; f.manager.stop(); expect(guard()).toBe(false);
    const requests = f.requests.length; f.setOnline(false); f.setOnline(true); await vi.advanceTimersByTimeAsync(120000);
    expect(f.open()).toHaveLength(0); expect(f.requests).toHaveLength(requests);
  });
  it('can retry after an offline transition cancels an earlier retry timer', async () => {
    const f = setup(); await f.session.login('826491'); f.manager.start(); await flush();
    f.open()[0].status('CHANNEL_ERROR'); f.setOnline(false); f.setUnavailable(true); f.setOnline(true); await flush();
    expect(f.open()).toHaveLength(0); f.setUnavailable(false);
    await vi.advanceTimersByTimeAsync(1100); await flush(); expect(f.open()).toHaveLength(1); f.manager.stop();
  });

  it('loads authoritative data even while the socket authentication handshake is pending', async () => {
    const f = setup(); let done!: () => void; f.setAuthPending(new Promise(resolve => { done = resolve; }));
    await f.session.login('826491'); f.manager.start(); await flush();
    expect(f.snapshots).toContain('first'); expect(f.channels).toHaveLength(0);
    done(); await flush(); f.manager.stop();
  });
  it('revalidates if the token expires during an asynchronous socket handshake', async () => {
    const f = setup(); let done!: () => void; f.setAuthPending(new Promise(resolve => { done = resolve; }));
    f.setToken(`e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 2 })).toString('base64url')}.fixture`);
    await f.session.login('826491'); f.manager.start(); await flush(); f.setValid(false);
    await vi.advanceTimersByTimeAsync(2001); done(); await flush();
    expect(f.channels).toHaveLength(0); expect(f.requests.some(x => x.endsWith('/session'))).toBe(true); f.manager.stop();
  });

});

it('waits for asynchronous socket shutdown before authenticating and joining again',async()=>{
 const f=setup();await f.session.login('826491');let finish!:()=>void;let joins=0;let applied=0;
 const manager=createWorkspaceRealtime({session:f.session,environment:{events:new EventTarget(),isOnline:()=>true},refetch:async()=>{},transport:{disconnect(){return new Promise<void>(r=>{finish=r;});},async authenticate(){applied++;},subscribe(){joins++;return{async remove(){}};}}});
 manager.start();await flush();expect(joins).toBe(0);expect(applied).toBe(0);finish();await flush();expect(joins).toBe(1);manager.stop();
});

it('does not restart a valid reconnect handshake every second while CDC is becoming ready',async()=>{
 const f=setup();await f.session.login('826491');let done!:()=>void;f.setAuthPending(new Promise<void>(r=>{done=r;}));f.manager.start();await flush();f.setOnline(false);f.setOnline(true);await flush();await vi.advanceTimersByTimeAsync(2200);
 expect(f.requests.filter(x=>x.endsWith('/session'))).toHaveLength(1);done();await flush();expect(f.open()).toHaveLength(1);f.manager.stop();
});
