'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from '@/i18n/routing';
import { locales, localeConfig, type Locale } from '@/i18n/config';
import { Globe } from 'lucide-react';

export default function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (newLocale: Locale) => {
    router.replace(pathname, { locale: newLocale });
  };

  return (
    <div className="relative group">
      <button className="flex items-center gap-2 text-gray-600 hover:text-orange-500 transition-colors">
        <Globe size={18} />
        <span className="font-medium">{localeConfig[locale].nativeName}</span>
      </button>

      <div className="absolute right-0 top-full mt-2 w-40 bg-white rounded-lg shadow-lg border border-gray-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
        {locales.map((l) => (
          <button
            key={l}
            onClick={() => handleChange(l)}
            className={`w-full text-left px-4 py-2 hover:bg-orange-50 transition-colors first:rounded-t-lg last:rounded-b-lg ${
              l === locale ? 'text-orange-500 bg-orange-50' : 'text-gray-700'
            }`}
          >
            {localeConfig[l].nativeName}
          </button>
        ))}
      </div>
    </div>
  );
}
