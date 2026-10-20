import { CANONICAL_USER_ID, SESSION_COOKIE, clearSessionCookie, getAuthClient, isSameOrigin, methodNotAllowed, noStore, readCookie, type ApiRequest, type ApiResponse } from '../_lib/auth.js';

// Revokes only the session represented by this device's HttpOnly refresh cookie.
export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  noStore(response);
  if (request.method !== 'POST') return methodNotAllowed(response);
  if (!isSameOrigin(request)) { response.status(403).json({ error: 'forbidden' }); return; }
  const refreshToken = readCookie(request, SESSION_COOKIE);
  const bearer = typeof request.headers.authorization === 'string' ? /^Bearer (.+)$/.exec(request.headers.authorization)?.[1] : undefined;
  if (!refreshToken && !bearer) { clearSessionCookie(response); response.status(204).end(); return; }
  try {
    const client = await getAuthClient();
    if (bearer) {
      const identity = await client.auth.getUser(bearer);
      if (!identity.error && identity.data.user?.id === CANONICAL_USER_ID) {
        const revoked = await client.auth.admin.signOut(bearer, 'local');
        if (revoked.error) throw new Error('revocation unavailable');
        clearSessionCookie(response); response.status(204).end(); return;
      }
      if (identity.error && ![400, 401, 403].includes(identity.error.status ?? 0)) throw new Error('revocation unavailable');
      if (!refreshToken) throw new Error('unable to confirm revocation');
    }
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken! });
    if (error) {
      // Invalid/revoked refresh tokens are already unusable; outages are not success.
      if (error.status === 400 || error.status === 401 || error.status === 403) {
        clearSessionCookie(response); response.status(204).end(); return;
      }
      throw new Error('revocation unavailable');
    }
    if (data.user?.id !== CANONICAL_USER_ID || !data.session?.access_token) throw new Error('invalid session');
    const result = await client.auth.admin.signOut(data.session.access_token, 'local');
    if (result.error) throw new Error('revocation unavailable');
    clearSessionCookie(response);
    response.status(204).end();
  } catch {
    // Keep the cookie so the pending local lock can retry revocation.
    response.status(503).json({ error: 'session_lock_unavailable' });
  }
}
