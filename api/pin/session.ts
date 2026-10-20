import { CANONICAL_USER_ID, SESSION_COOKIE, clearSessionCookie, noStore, readCookie, setSessionCookie, getAuthClient, type ApiRequest, type ApiResponse } from '../_lib/auth.js';

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  noStore(response);
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); response.status(405).json({ error: 'method_not_allowed' }); return; }
  const refreshToken = readCookie(request, SESSION_COOKIE);
  if (!refreshToken) { response.status(401).json({ error: 'session_missing' }); return; }

  try {
    const client = await getAuthClient();
    const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
    if (error || data.user?.id !== CANONICAL_USER_ID || !data.session?.refresh_token || !data.session.access_token) {
      clearSessionCookie(response);
      response.status(401).json({ error: 'session_expired' });
      return;
    }
    setSessionCookie(response, data.session.refresh_token);
    response.status(200).json({ accessToken: data.session.access_token });
  } catch {
    response.status(503).json({ error: 'session_unavailable' });
  }
}
