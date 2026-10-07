import { describe, expect, it } from 'vitest';
import { DEFAULT_FONT_PREFERENCES, FONT_OPTIONS, parseFontPreferences } from './fonts';

describe('font preferences', () => {
  it('restores separately selected primary and secondary scripts', () => {
    expect(parseFontPreferences(JSON.stringify({ primary: 'thuluth', secondary: 'nastaliq' }))).toEqual({
      primary: 'thuluth', secondary: 'nastaliq'
    });
  });

  it('falls back independently when a saved script is unknown', () => {
    expect(parseFontPreferences(JSON.stringify({ primary: 'missing', secondary: 'naskh' }))).toEqual({
      ...DEFAULT_FONT_PREFERENCES, secondary: 'naskh'
    });
  });

  it('provides each requested Arabic calligraphic style as a selectable option', () => {
    expect(FONT_OPTIONS.map((option) => option.label)).toEqual([
      'الكوفي', 'المحقق والريحاني', 'خط الطومار', 'الجليل أو الجلي', 'الثلث', 'النسخ',
      'الفارسي (التعليق)', 'الشكستة (المكسر)', 'الديواني', 'جلي الديواني', 'الرقعة'
    ]);
  });
});
