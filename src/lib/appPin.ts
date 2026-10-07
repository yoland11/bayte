import { normalizeDigits } from './money';

const APP_PIN = '1998';

export function verifyAppPin(value: string): boolean {
  const normalized = normalizeDigits(value);
  return /^\d{4}$/.test(normalized) && normalized === APP_PIN;
}
