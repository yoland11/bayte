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

export async function ensureCloudUser<TUser>(auth: PinSessionAuth<TUser>): Promise<TUser> {
  const { data, error } = await auth.getSession();
  if (error) throw error;
  if (data.session?.user) return data.session.user;

  const anonymous = await auth.signInAnonymously();
  if (anonymous.error) throw anonymous.error;
  if (!anonymous.data.user) throw new Error('تعذر إنشاء جلسة Supabase مجهولة');
  return anonymous.data.user;
}
