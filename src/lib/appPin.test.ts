import { describe, expect, it } from 'vitest';
import { verifyAppPin } from './appPin';

describe('application PIN gate', () => {
  it('accepts the configured PIN when entered with English digits', () => {
    expect(verifyAppPin('1998')).toBe(true);
  });

  it('normalizes Arabic and Persian keypad digits before checking the PIN', () => {
    expect(verifyAppPin('١٩٩٨')).toBe(true);
    expect(verifyAppPin('۱۹۹۸')).toBe(true);
  });

  it('rejects other values, partial PINs, and extra digits', () => {
    expect(verifyAppPin('1999')).toBe(false);
    expect(verifyAppPin('199')).toBe(false);
    expect(verifyAppPin('19980')).toBe(false);
  });
});
