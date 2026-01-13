export const locales = ['en', 'tr', 'ru', 'uz', 'ar'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

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
