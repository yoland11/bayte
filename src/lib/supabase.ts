import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim() ?? '';

export const supabaseConfigured = Boolean(url && publicKey);
export const supabase = supabaseConfigured ? createClient(url, publicKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

export function requireSupabase() {
  if (!supabase) throw new Error('يلزم إعداد اتصال Supabase أولاً');
  return supabase;
}
