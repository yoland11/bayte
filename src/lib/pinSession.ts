export type PinSessionFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
interface PinSessionResponse { accessToken?: unknown }
export const LOCK_INTENT_KEY = 'beity-session-revocation-pending';
export type LockIntentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export interface PinSessionClient {
  accessToken(): string | null;
  login(pin: string): Promise<void>;
  restore(): Promise<boolean>;
  lock(): Promise<void>;
  onLock(listener: () => void): () => void;
  onTokenChange(listener: (token: string | null) => void): () => void;
}
// This is only an expiry guard; Supabase remains responsible for signature/authorization checks.
export function accessTokenExpiresAt(token: string | null): number | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const exp: unknown = JSON.parse(atob(payload)).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch { return null; }
}
function browserStorage(): LockIntentStorage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
export function createPinSession(fetcher: PinSessionFetch = fetch, storage = browserStorage()): PinSessionClient {
  let token: string | null = null;
  let generation = 0;
  let pending = false;
  let queue: Promise<unknown> = Promise.resolve();
  const listeners = new Set<() => void>();
  const tokenListeners = new Set<(token: string | null) => void>();
  const publish = (value: string | null) => { token = value; tokenListeners.forEach(listener => listener(value)); };
  const hasIntent = () => { try { return pending || storage?.getItem(LOCK_INTENT_KEY) === '1'; } catch { return pending; } };
  const forget = () => { publish(null); generation++; listeners.forEach((listener) => listener()); };
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = queue.then(operation, operation); queue = result.catch(() => {}); return result;
  };
  const revoke = async (accessToken?: string | null) => {
    try {
      const response = await fetcher('/api/pin/logout', { method: 'POST', credentials: 'same-origin', ...(accessToken ? { headers: { authorization: `Bearer ${accessToken}` } } : {}) });
      // Only the real logout API's explicit contract confirms revocation.
      // A static maintenance/protection HTML page can otherwise return 200.
      if (response.status !== 204) throw new Error();
      pending = false;
      try { storage?.removeItem(LOCK_INTENT_KEY); } catch { /* A retained marker fails closed. */ }
    } catch { throw new Error('session-lock-unavailable'); }
  };
  return {
    accessToken: () => hasIntent() || (accessTokenExpiresAt(token) ?? Infinity) <= Date.now() ? null : token,
    login(pin) {
      const current = generation;
      return enqueue(async () => {
        if (hasIntent()) await revoke();
        const response = await fetcher('/api/pin/login', { credentials: 'same-origin', method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
        if (current !== generation) throw new Error('session-locked');
        if (!response.ok) { forget(); throw new Error(response.status === 429 ? 'pin-rate-limited' : response.status === 401 ? 'pin-invalid' : 'pin-unavailable'); }
        const payload = await response.json() as PinSessionResponse;
        if (current !== generation) throw new Error('session-locked');
        if (typeof payload.accessToken !== 'string' || !payload.accessToken) { forget(); throw new Error('pin-invalid'); }
        publish(payload.accessToken);
      });
    },
    restore() {
      const current = generation;
      return enqueue(async () => {
        if (hasIntent()) { await revoke(); return false; }
        const response = await fetcher('/api/pin/session', { method: 'GET', credentials: 'same-origin' });
        if (current !== generation) return false;
        if (response.status === 401) { forget(); return false; }
        if (!response.ok) throw new Error('session-unavailable');
        const payload = await response.json() as PinSessionResponse;
        if (current !== generation) return false;
        if (typeof payload.accessToken !== 'string' || !payload.accessToken) throw new Error('session-unavailable');
        publish(payload.accessToken); return true;
      });
    },
    lock() {
      const accessToken = token;
      pending = true;
      try { storage?.setItem(LOCK_INTENT_KEY, '1'); } catch { /* No credential is stored here. */ }
      forget();
      return enqueue(async () => { if (hasIntent()) await revoke(accessToken); });
    },
    onTokenChange(listener) { tokenListeners.add(listener); return () => { tokenListeners.delete(listener); }; },
    onLock(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== LOCK_INTENT_KEY) return;
        if (event.newValue === '1') { pending = true; forget(); }
        else if (event.newValue === null) pending = false;
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => { listeners.delete(listener); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); };
    }
  };
}
