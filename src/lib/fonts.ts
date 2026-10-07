export const FONT_OPTIONS = [
  { id: 'kufi', label: 'الكوفي', family: 'Noto Kufi Arabic' },
  { id: 'muhaqqaq', label: 'المحقق والريحاني', family: 'Amiri' },
  { id: 'tumar', label: 'خط الطومار', family: 'Lateef' },
  { id: 'jalil', label: 'الجليل أو الجلي', family: 'Kufam' },
  { id: 'thuluth', label: 'الثلث', family: 'Rakkas' },
  { id: 'naskh', label: 'النسخ', family: 'Noto Naskh Arabic' },
  { id: 'nastaliq', label: 'الفارسي (التعليق)', family: 'Noto Nastaliq Urdu' },
  { id: 'shekasteh', label: 'الشكستة (المكسر)', family: 'Mirza' },
  { id: 'diwani', label: 'الديواني', family: 'Vibes' },
  { id: 'diwani-jali', label: 'جلي الديواني', family: 'Aref Ruqaa Ink' },
  { id: 'ruqaa', label: 'الرقعة', family: 'Aref Ruqaa' }
] as const;

export type FontStyleId = typeof FONT_OPTIONS[number]['id'];

export interface FontPreferences {
  primary: FontStyleId;
  secondary: FontStyleId;
}

export const DEFAULT_FONT_PREFERENCES: FontPreferences = { primary: 'kufi', secondary: 'kufi' };

export const FONT_PREFERENCES_STORAGE_KEY = 'bayti-font-preferences';

export function isFontStyleId(value: unknown): value is FontStyleId {
  return typeof value === 'string' && FONT_OPTIONS.some((option) => option.id === value);
}

export function fontFamilyFor(id: FontStyleId): string {
  const family = FONT_OPTIONS.find((option) => option.id === id)?.family ?? 'Noto Kufi Arabic';
  return `'${family}', 'Noto Kufi Arabic', 'Geeza Pro', Tahoma, Arial, sans-serif`;
}

export function parseFontPreferences(value: string | null): FontPreferences {
  if (!value) return DEFAULT_FONT_PREFERENCES;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_FONT_PREFERENCES;
    const preferences = parsed as Record<string, unknown>;
    return {
      primary: isFontStyleId(preferences.primary) ? preferences.primary : DEFAULT_FONT_PREFERENCES.primary,
      secondary: isFontStyleId(preferences.secondary) ? preferences.secondary : DEFAULT_FONT_PREFERENCES.secondary
    };
  } catch {
    return DEFAULT_FONT_PREFERENCES;
  }
}
