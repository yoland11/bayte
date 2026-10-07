export interface PinSessionAuth<TUser> {
  getSession(): Promise<{
    data: { session: { user: TUser } | null };
    error: Error | null;
  }>;
  signInAnonymously(): Promise<{
    data: { user: TUser | null };
    error: Error | null;
  }>;
}

export interface PinUnlockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PIN_UNLOCKED_USER_KEY = 'bayti-pin-unlocked-user';

export function isPinUnlockedForUser(userId: string | null, storage: PinUnlockStorage): boolean {
  if (!userId) return false;
  try {
    return storage.getItem(PIN_UNLOCKED_USER_KEY) === userId;
  } catch {
    return false;
  }
}

export function savePinUnlock(userId: string, storage: PinUnlockStorage): void {
  try {
    storage.setItem(PIN_UNLOCKED_USER_KEY, userId);
  } catch {
    // Keep the current page usable if browser storage is unavailable.
  }
}

export function clearPinUnlock(storage: PinUnlockStorage): void {
  try {
    storage.removeItem(PIN_UNLOCKED_USER_KEY);
  } catch {
    // The in-memory lock still takes effect if browser storage is unavailable.
  }
}

export async function ensureCloudUser<TUser>(auth: PinSessionAuth<TUser>): Promise<TUser> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (data.session?.user) return data.session.user;

  const anonymous = await auth.signInAnonymously();
  if (anonymous.error) throw anonymous.error;
  if (!anonymous.data.user) throw new Error('تعذر إنشاء جلسة Supabase مجهولة');
  return anonymous.data.user;
}
