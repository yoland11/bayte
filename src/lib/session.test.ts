import { describe, expect, it, vi } from 'vitest';
import { ensureCloudUser } from './session';

describe('PIN-only cloud session', () => {
  it('reuses an existing Supabase session without creating another user', async () => {
    const existingUser = { id: 'existing-user' };
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: existingUser } }, error: null }),
      signInAnonymously: vi.fn()
    };

    await expect(ensureCloudUser(auth)).resolves.toBe(existingUser);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('creates an anonymous Supabase user when no session exists', async () => {
    const anonymousUser = { id: 'anonymous-user' };
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously: vi.fn().mockResolvedValue({ data: { user: anonymousUser }, error: null })
    };

    await expect(ensureCloudUser(auth)).resolves.toBe(anonymousUser);
    expect(auth.signInAnonymously).toHaveBeenCalledOnce();
  });

  it('propagates an anonymous sign-in error instead of opening without cloud identity', async () => {
    const authError = new Error('anonymous sign-ins disabled');
    const auth = {
      getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signInAnonymously: vi.fn().mockResolvedValue({ data: { user: null }, error: authError })
    };

    await expect(ensureCloudUser(auth)).rejects.toBe(authError);
  });
});
