'use client';

import { Link } from '@/i18n/routing';
import { useLocale, useTranslations } from 'next-intl';
import { Phone } from 'lucide-react';

export default function Footer() {
  const t = useTranslations('footer');
  const locale = useLocale();

  const productLinks = [
    { label: t('links.features'), href: '#features' },
    { label: t('links.pricing'), href: '#pricing' },
    { label: t('links.security'), href: '#security' },
    // Locale-aware page links (rest are anchors). Renderer below switches
    // between <Link> and <a> based on the href shape.
    { label: t('links.qrMenu'), href: '/qr-menu' },
    { label: t('links.cloudKitchen'), href: '/bulut-mutfak' },
    { label: t('links.shop'), href: '/store' },
  ];

  // about / blog / careers have no pages behind them. A footer full of dead
  // links reads as an abandoned site to a visitor and wastes crawl budget.
  const companyLinks = [
    { label: t('links.qrMenu'), href: '/qr-menu' },
    { label: t('links.cloudKitchen'), href: '/bulut-mutfak' },
    { label: t('links.shop'), href: '/store' },
    { label: t('links.contact'), href: '/contact' },
  ];

  const legalLinks = [
    { label: t('links.privacy'), href: '/privacy' },
    { label: t('links.terms'), href: '/terms' },
    { label: t('links.contact'), href: '/contact' },
  ];

  // These three hosts are live and carry 122 pages between them. They were all
  // href="#", so nothing on this site linked to either portal — which is the
  // whole reason neither was reachable by a crawler. The locale segment is
  // passed through: both portals are bilingual on tr/en, and any other locale
  // falls back to Turkish, which is their default.
  const docsLocale = locale === 'en' ? 'en' : 'tr';
  const supportLinks = [
    { label: t('links.helpCenter'), href: `https://help.hummytummy.com/${docsLocale}` },
    { label: t('links.documentation'), href: `https://developer.hummytummy.com/${docsLocale}` },
    { label: t('links.apiReference'), href: `https://developer.hummytummy.com/${docsLocale}/api` },
    // Turkish-only page; linking it from other locales would send readers to a
    // 404 (its generateStaticParams returns 'tr' alone).
    ...(locale === 'tr'
      ? [{ label: t('links.eAdisyon'), href: '/e-adisyon-zorunlu-mu' }]
      : []),
    { label: t('links.contact'), href: '/contact' },
  ];

  return (
    <footer className="bg-slate-50 border-t border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand & Contact */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="text-xl font-bold text-slate-900">
              HummyTummy
            </Link>
            <p className="mt-4 text-sm text-slate-500 max-w-xs">
              {t('description')}
            </p>
            <div className="mt-6 space-y-2">
              <h3 className="font-semibold text-slate-900">{t('contact')}</h3>
              <p className="text-sm text-slate-500">
                {t('address')}
              </p>
              <a
                href="tel:+908508407303"
                className="flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
              >
                <Phone className="h-4 w-4 shrink-0 text-orange-500" />
                <span dir="ltr">{t('phone')}</span>
              </a>
            </div>
          </div>

          {/* Product Links */}
          <div>
            <h3 className="font-semibold text-slate-900 mb-4">{t('product')}</h3>
            <ul className="space-y-3">
              {productLinks.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith('/') && !link.href.startsWith('/#') ? (
                    <Link
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Company Links */}
          <div>
            <h3 className="font-semibold text-slate-900 mb-4">{t('company')}</h3>
            <ul className="space-y-3">
              {companyLinks.map((link) => (
                <li key={link.label}>
                  <Link
                    href={link.href}
                    className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Support Links */}
          <div>
            <h3 className="font-semibold text-slate-900 mb-4">{t('support')}</h3>
            <ul className="space-y-3">
              {supportLinks.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith('/') ? (
                    <Link
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="font-semibold text-slate-900 mb-4">{t('legal')}</h3>
            <ul className="space-y-3">
              {legalLinks.map((link) => (
                <li key={link.label}>
                  {link.href.startsWith('/') && !link.href.startsWith('/#') ? (
                    <Link
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </Link>
                  ) : (
                    <a
                      href={link.href}
                      className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                    >
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="mt-12 pt-8 border-t border-slate-200">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-slate-500">
              &copy; {new Date().getFullYear()} {t('copyright')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
