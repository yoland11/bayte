import { CANONICAL_USER_ID, SESSION_COOKIE, enforceRateLimit, env, isSameOrigin, methodNotAllowed, noStore, normalizePin, readCookie, requestIp, getAuthClient, getServiceClient, setSessionCookie, type ApiRequest, type ApiResponse } from '../_lib/auth.js';
import { verifyPinHash } from '../_lib/pin.js';
import { issueExistingUserSession } from '../_lib/sessionIssuer.js';

export default async function handler(request: ApiRequest, response: ApiResponse): Promise<void> {
  noStore(response);
  if (request.method !== 'POST') return methodNotAllowed(response);
  if (!isSameOrigin(request)) { response.status(403).json({ error: 'forbidden' }); return; }

  try {
    const ip = requestIp(request);
    if (!await enforceRateLimit(ip)) { response.status(429).json({ error: 'rate_limited' }); return; }
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const pin = normalizePin(body && typeof body === 'object' ? (body as { pin?: unknown }).pin : null);
    if (!pin) {
      response.status(401).json({ error: 'invalid_pin' });
      return;
    }

    const hash = env('BEITY_PIN_ARGON2_HASH');
    if (!await verifyPinHash(hash, pin)) {
      response.status(401).json({ error: 'invalid_pin' });
      return;
    }

    const issuer=process.env.BEITY_SESSION_ISSUER?.trim()||'server_password';
    if(!['password','server_password'].includes(issuer))throw Error('Invalid session issuer');
    const client = await getAuthClient();
    const existingRefreshToken = readCookie(request, SESSION_COOKIE);
    let session = existingRefreshToken
      ? (await client.auth.refreshSession({ refresh_token: existingRefreshToken })).data.session
      : null;
    if (session?.user?.id !== CANONICAL_USER_ID) {
      session=await issueExistingUserSession(await getServiceClient(),client,env('BEITY_CANONICAL_EMAIL'),env('BEITY_CANONICAL_PASSWORD'));
    }
    if (!session?.refresh_token || !session.access_token) {
      response.status(503).json({ error: 'authentication_unavailable' });
      return;
    }

    setSessionCookie(response, session.refresh_token);
    response.status(200).json({ accessToken: session.access_token });
  } catch {
    response.status(503).json({ error: 'authentication_unavailable' });
  }
}
