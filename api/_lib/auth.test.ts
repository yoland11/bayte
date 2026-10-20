import { describe, expect, it } from 'vitest';
import { normalizePin, readCookie } from './auth';

describe('server PIN input handling', () => {
  it('normalizes Arabic and Persian numerals to English digits', () => {
    expect(normalizePin('٤٨٢٦')).toBe('4826');
    expect(normalizePin('۴۸۲۶')).toBe('4826');
  });

  it('rejects non-numeric and out-of-range PIN input', () => {
    expect(normalizePin('199')).toBeNull();
    expect(normalizePin('1234567890123')).toBeNull();
    expect(normalizePin('12ab')).toBeNull();
  });

  it('reads only the requested refresh cookie and preserves encoded delimiters', () => {
    expect(readCookie({ headers: { cookie: 'other=x; beity_session=token%3Dwith%3Ddelimiters' } }, 'beity_session'))
      .toBe('token=with=delimiters');
  });
});

import { requestIp, requestNetwork } from './auth';
it('canonicalizes equivalent IPv6 representations before applying IP limits', () => {
  expect(requestIp({ headers: { 'x-real-ip': '2001:0db8:0000:0000:0000:0000:0000:0001' } })).toBe('2001:db8::1');
  expect(requestNetwork('2001:db8::1')).toBe(requestNetwork('2001:db8:0:0:abcd::2'));
});
it('rejects malformed proxy IPs rather than using arbitrary client-controlled identifiers', () => {
  expect(requestIp({ headers: { 'x-real-ip': 'not-an-address' } })).toBe('unknown');
});
it('groups IPv4-mapped IPv6 with the equivalent IPv4 address', () => {
  expect(requestIp({ headers: { 'x-real-ip': '::ffff:192.0.2.1' } })).toBe('192.0.2.1');
  expect(requestNetwork('::ffff:192.0.2.1')).toBe('192.0.2.0/24');
});
