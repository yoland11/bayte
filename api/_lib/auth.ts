import { assertEnvironment, verifyEnvironment } from './environment.js';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const CANONICAL_USER_ID = 'e4afb7c8-0915-4b5f-8805-66c292a5d3b6';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const isProduction = process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
export const SESSION_COOKIE = isProduction ? '__Host-beity-session' : 'beity_session';

export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  url?: string;
}
export interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string | string[]): void;
  json(value: unknown): void;
  end(body?: Uint8Array): void;
  write?(body: Uint8Array): boolean;
}

export function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

function supabaseUrl(): string {
  assertEnvironment();
  return process.env.SUPABASE_URL?.trim() || env('VITE_SUPABASE_URL');
}

export function noStore(response: ApiResponse): void {
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

export function isSameOrigin(request: ApiRequest): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try { return new URL(origin).host === host; }
  catch { return false; }
}

export function normalizePin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[٠-٩۰-۹]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) >= 0x06f0 ? digit.charCodeAt(0) - 0x06f0 + 48 : digit.charCodeAt(0) - 0x0660 + 48));
  return /^\d{4,12}$/.test(digits) ? digits : null;
}

export function rateLimitKey(scope: string, ip: string): string {
  return createHmac('sha256', env('BEITY_RATE_LIMIT_SECRET')).update(`${scope}:${ip}`).digest('hex');
}

function normalizeIp(ip: string): string {
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  let normalized: string;
  try { normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1); } catch { return 'unknown'; }
  const mapped = /^::ffff:([0-9a-f]+):([0-9a-f]+)$/.exec(normalized);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join('.');
  }
  return normalized;
}
export function requestIp(request: ApiRequest): string {
  // Deployment's trusted proxy MUST overwrite these headers, never append client input.
  const realIp = request.headers['x-real-ip'];
  const forwarded = request.headers['x-forwarded-for'];
  const ip = typeof realIp === 'string' ? realIp : typeof forwarded === 'string' ? forwarded.split(',')[0] : '';
  return normalizeIp(ip.trim());
}

export async function getServiceClient(): Promise<SupabaseClient> {
  await verifyEnvironment();
  return createClient(supabaseUrl(), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export async function getAuthClient() {
  await verifyEnvironment();
  const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || env('VITE_SUPABASE_PUBLISHABLE_KEY');
  return createClient(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export function requestNetwork(ip: string): string {
  ip = normalizeIp(ip);
  if (isIP(ip) === 4) return ip.split('.').slice(0, 3).join('.') + '.0/24';
  if (isIP(ip) === 6) {
    // Canonicalize compressed IPv6 before grouping by /64.
    const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
    const parts = normalized.split('::');
    const left = parts[0] ? parts[0].split(':') : [];
    const right = parts[1] ? parts[1].split(':') : [];
    const groups = parts.length === 2 ? [...left, ...Array(8-left.length-right.length).fill('0'), ...right] : left;
    return groups.slice(0, 4).map((part) => parseInt(part, 16).toString(16)).join(':') + '::/64';
  }
  return 'unknown';
}

export async function enforceRateLimit(ip: string): Promise<boolean> {
  const result = await (await getServiceClient()).rpc('beity_reserve_pin_attempt', {
    p_identifier_hash: rateLimitKey('ip', ip),
    p_network_hash: rateLimitKey('network', requestNetwork(ip))
  });
  if (result.error) throw new Error('PIN rate limiter unavailable');
  return result.data === true;
}

export function setSessionCookie(response: ApiResponse, refreshToken: string): void {
  const secure = isProduction ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(refreshToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

export function clearSessionCookie(response: ApiResponse): void {
  const secure = isProduction ? '; Secure' : '';
  response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`);
}

export function readCookie(request: ApiRequest, name: string): string | null {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...valueParts] = part.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(valueParts.join('=')); }
      catch { return null; }
    }
  }
  return null;
}

export function methodNotAllowed(response: ApiResponse): void {
  response.setHeader('Allow', 'POST');
  response.status(405).json({ error: 'method_not_allowed' });
}
