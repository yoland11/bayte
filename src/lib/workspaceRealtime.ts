import type { SupabaseClient } from '@supabase/supabase-js';
import { accessTokenExpiresAt, type PinSessionClient } from './pinSession';

export interface RealtimeTransport {
  authenticate(token: string): Promise<void>;
  subscribe(onChange: () => void, onStatus: (status: string) => void): { remove(): Promise<void> };
  disconnect(): void | Promise<void>;
}
interface Options {
  transport: RealtimeTransport;
  session: PinSessionClient;
  refetch(isCurrent: () => boolean): Promise<void>;
  environment?: { events: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>; isOnline(): boolean };
  onOnlineChange?(online: boolean): void;
}

// Each epoch owns both the socket callbacks and any authoritative reads they start.
export function createWorkspaceRealtime({ transport, session, refetch, environment = { events: window, isOnline: () => navigator.onLine }, onOnlineChange }: Options) {
  let running = false, epoch = 0;
  let channel: ReturnType<RealtimeTransport['subscribe']> | null = null;
  let serial: Promise<unknown> = Promise.resolve();
  let validation: Promise<void> | null = null;
  let validating = false;
  let connecting: number | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;
  const current = (version: number, token: string) => running && epoch === version && environment.isOnline() && session.accessToken() === token;
  const invalidate = () => {
    ++epoch; connecting = null; clearTimeout(retry); retry = undefined; clearTimeout(changeTimer); clearTimeout(expiryTimer);
    const old = channel; channel = null;
    // Socket shutdown is asynchronous in the SDK. A new join while it is
    // disconnecting is ignored; wait for closure and then tear down its channel.
    const disconnected = Promise.resolve(transport.disconnect()).catch(() => {});
    const removed = old ? old.remove().catch(() => {}) : Promise.resolve();
    serial = Promise.allSettled([serial, disconnected, removed]);
    return epoch;
  };
  const retryValidation = () => {
    if (!running || !environment.isOnline() || retry) return;
    const version = epoch;
    retry = setTimeout(() => { retry = undefined; if (running && version === epoch) void validate(); }, 1000);
  };
  const read = (guard: () => boolean) => {
    if (guard()) void refetch(guard).catch(() => {});
  };
  const connect = () => {
    const version = invalidate(), token = session.accessToken();
    if (!running || !environment.isOnline() || !token) return;
    connecting = version;
    const guard = () => current(version, token);
    read(guard);
    const expires = accessTokenExpiresAt(token);
    if (expires !== null) expiryTimer = setTimeout(() => { invalidate(); void validate(); }, Math.max(0, expires - Date.now()));
    serial = serial.catch(() => {}).then(async () => {
      if (!current(version, token)) return;
      // The SDK may have cached its public key before PIN login. Always await this.
      await transport.authenticate(token);
      if (!current(version, token)) return;
      const created = transport.subscribe(() => {
        if (!guard()) return;
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => read(guard), 250);
      }, status => {
        if (!guard()) return;
        if (status === 'SUBSCRIBED') { clearTimeout(retry); retry = undefined; read(guard); }
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) { invalidate(); retryValidation(); }
      });
      if (guard()) { channel = created; connecting = null; }
      else await created.remove();
    }).catch(() => { if (running && epoch === version) { invalidate(); retryValidation(); } });
  };
  const validate = (): Promise<void> => {
    if (!running || !environment.isOnline()) return Promise.resolve();
    if (validation) return validation;
    const version = invalidate();
    validating = true;
    validation = (async () => {
      try {
        const restored = await session.restore();
        if (!running || version !== epoch || !environment.isOnline()) return;
        if (restored && session.accessToken()) connect();
      } catch { if (running && version === epoch) retryValidation(); }
      finally {
        validating = false; validation = null;
        if (running && environment.isOnline() && !channel && connecting === null && session.accessToken()) retryValidation();
      }
    })();
    return validation;
  };
  const online = () => { onOnlineChange?.(environment.isOnline()); void validate(); };
  const offline = () => { onOnlineChange?.(false); invalidate(); };
  const focus = () => { void validate(); };
  return {
    start() {
      if (running) return;
      running = true;
      unsubscribe = session.onTokenChange(() => {
        if (!running) return;
        if (!session.accessToken()) invalidate();
        else if (!validating) connect();
      });
      environment.events.addEventListener('online', online);
      environment.events.addEventListener('offline', offline);
      environment.events.addEventListener('focus', focus);
      interval = setInterval(() => { void validate(); }, 60_000);
      onOnlineChange?.(environment.isOnline());
      connect();
    },
    stop() {
      running = false; invalidate(); clearInterval(interval); unsubscribe?.();
      environment.events.removeEventListener('online', online);
      environment.events.removeEventListener('offline', offline);
      environment.events.removeEventListener('focus', focus);
    }
  };
}

// Serialize SDK auth/removal across StrictMode cleanup and a new mounted controller.
const sdkOperations = new WeakMap<SupabaseClient, Promise<unknown>>();
let channelSequence = 0;
export function supabaseRealtimeTransport(client: SupabaseClient, projectId: string, userId: string): RealtimeTransport {
  const exclusive = (operation: () => Promise<unknown>): Promise<void> => {
    const next = (sdkOperations.get(client) ?? Promise.resolve()).catch(() => {}).then(operation);
    sdkOperations.set(client, next);
    return next.then(() => {});
  };
  return {
    authenticate: token => exclusive(() => client.realtime.setAuth(token)),
    subscribe(onChange, onStatus) {
      const c = client.channel(`beity-shared-workspace-${++channelSequence}`, { config: { postgres_changes_options: { wait: true } } });
      for (const table of ['transactions', 'clients', 'categories', 'construction_stages', 'attachments']) {
        c.on('postgres_changes', { event: '*', schema: 'public', table, filter: `project_id=eq.${projectId}` }, onChange);
      }
      c.on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `user_id=eq.${userId}` }, onChange)
        .subscribe(onStatus);
      return { remove: () => exclusive(() => client.removeChannel(c)) };
    },
    disconnect() { return exclusive(() => client.realtime.disconnect()); }
  };
}
