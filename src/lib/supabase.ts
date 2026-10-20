import { createClient } from '@supabase/supabase-js';
import { createPinSession } from './pinSession';
import { createProtectedFiles } from './protectedFiles';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim() ?? '';

export const supabaseConfigured = Boolean(url && publicKey);
export const pinSession = createPinSession();
export const protectedFiles = createProtectedFiles(pinSession);
export const supabase = supabaseConfigured ? createClient(url, publicKey, {
  accessToken: async () => pinSession.accessToken(),
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
}) : null;

export function requireSupabase() {
  if (!supabase) throw new Error('يلزم إعداد اتصال Supabase أولاً');
  return supabase;
}
