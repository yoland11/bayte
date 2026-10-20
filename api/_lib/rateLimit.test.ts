import { beforeEach, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ counts: new Map<string, number>() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: async (name: string, args: { p_identifier_hash: string }) => {
  if (name !== 'beity_reserve_pin_attempt') return { error: { message: 'legacy check/failure split is unsafe' }, data: null };
  const count = db.counts.get(args.p_identifier_hash) ?? 0; db.counts.set(args.p_identifier_hash, count + 1);
  return { error: null, data: count < 5 };
} }) }));
import { enforceRateLimit } from './auth';
beforeEach(() => { db.counts.clear(); vi.stubEnv('SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'isolated-public'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'isolated'); vi.stubEnv('BEITY_RATE_LIMIT_SECRET', 'isolated-secret'); });
it('reserves attempts before verification rather than checking then recording later', async () => {
  const result = await Promise.all(Array.from({ length: 20 }, () => enforceRateLimit('192.0.2.1')));
  expect(result.filter(Boolean)).toHaveLength(5);
});
it('does not globally lock another device after five failures elsewhere', async () => {
  await Promise.all(Array.from({ length: 5 }, () => enforceRateLimit('192.0.2.1')));
  await expect(enforceRateLimit('192.0.2.2')).resolves.toBe(true);
});
