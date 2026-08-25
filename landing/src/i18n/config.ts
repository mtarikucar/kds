export const locales = ['en', 'tr', 'ru', 'uz', 'ar'] as const;
export type Locale = (typeof locales)[number];

// Türkiye-first: a crawler sends no Accept-Language, so the unprefixed
// entry point has to resolve to the market this site is written for.
export const defaultLocale: Locale = 'tr';

export const localeConfig: Record<
  Locale,
  {
    name: string;
    nativeName: string;
    dir: 'ltr' | 'rtl';
    hreflang: string;
  }
> = {
  en: { name: 'English', nativeName: 'English', dir: 'ltr', hreflang: 'en' },
  tr: { name: 'Turkish', nativeName: 'Türkçe', dir: 'ltr', hreflang: 'tr' },
  ru: { name: 'Russian', nativeName: 'Русский', dir: 'ltr', hreflang: 'ru' },
  uz: { name: 'Uzbek', nativeName: "O'zbek", dir: 'ltr', hreflang: 'uz' },
  ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl', hreflang: 'ar' },
};
