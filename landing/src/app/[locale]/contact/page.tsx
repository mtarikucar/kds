'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';
import ContactForm from '@/components/contact/ContactForm';
import { Phone, Mail } from 'lucide-react';

export default function ContactPage() {
  const t = useTranslations('contact');

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 md:py-24">
          <div className="mb-8">
            <Link
              href="/"
              className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
            >
              ← {t('backToHome')}
            </Link>
          </div>

          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
            {t('title')}
          </h1>
          <p className="text-slate-500 mb-12">{t('subtitle')}</p>

          {/* Prominent contact methods — call or email directly */}
          <div className="grid gap-4 sm:grid-cols-2 mb-12">
            <a
              href="tel:+908508407303"
              className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-orange-300 hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                <Phone className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-slate-500">{t('labels.phone')}</span>
                <span className="block text-lg font-semibold text-slate-900" dir="ltr">
                  {t('phone')}
                </span>
              </span>
            </a>
            <a
              href="mailto:contact@hummytummy.com"
              className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:border-orange-300 hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                <Mail className="h-6 w-6" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm text-slate-500">{t('labels.email')}</span>
                <span className="block truncate text-lg font-semibold text-slate-900" dir="ltr">
                  contact@hummytummy.com
                </span>
              </span>
            </a>
          </div>

          {/* v2.8.98 — interactive contact form. Email links below are
              kept as a fallback for users who prefer their own mail
              client. */}
          <div className="mb-12">
            <ContactForm />
          </div>

          <div className="prose prose-slate max-w-none">
            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.general.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.general.content')}
              </p>
              <p className="mt-4 text-slate-800">
                <strong>{t('labels.email')}:</strong>{' '}
                <a
                  href="mailto:contact@hummytummy.com"
                  className="text-primary-600 hover:text-primary-700"
                >
                  contact@hummytummy.com
                </a>
              </p>
              <p className="mt-2 text-slate-800">
                <strong>{t('labels.phone')}:</strong>{' '}
                <a
                  href="tel:+908508407303"
                  className="text-primary-600 hover:text-primary-700"
                  dir="ltr"
                >
                  {t('phone')}
                </a>
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.support.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.support.content')}
              </p>
              <p className="mt-4 text-slate-800">
                <strong>{t('labels.email')}:</strong>{' '}
                <a
                  href="mailto:contact@hummytummy.com"
                  className="text-primary-600 hover:text-primary-700"
                >
                  contact@hummytummy.com
                </a>
              </p>
              <p className="mt-2 text-slate-800">
                <strong>{t('labels.phone')}:</strong>{' '}
                <a
                  href="tel:+908508407303"
                  className="text-primary-600 hover:text-primary-700"
                  dir="ltr"
                >
                  {t('phone')}
                </a>
              </p>
              <p className="text-slate-600 mt-2 text-sm">
                {t('sections.support.hours')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.kvkk.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.kvkk.content')}
              </p>
              <p className="mt-4 text-slate-800">
                <strong>{t('labels.email')}:</strong>{' '}
                <a
                  href="mailto:contact@hummytummy.com"
                  className="text-primary-600 hover:text-primary-700"
                >
                  contact@hummytummy.com
                </a>
              </p>
              <p className="text-slate-600 mt-2 text-sm">
                {t.rich('sections.kvkk.linkHint', {
                  link: (chunks) => (
                    <Link href="/legal/kvkk" className="text-primary-600 hover:text-primary-700 underline">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.legal.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.legal.content')}
              </p>
              <ul className="mt-4 space-y-2">
                <li>
                  <Link
                    href="/legal/kvkk"
                    className="text-primary-600 hover:text-primary-700"
                  >
                    {t('sections.legal.links.kvkk')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/legal/distance-sales"
                    className="text-primary-600 hover:text-primary-700"
                  >
                    {t('sections.legal.links.distanceSales')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/legal/refund-policy"
                    className="text-primary-600 hover:text-primary-700"
                  >
                    {t('sections.legal.links.refundPolicy')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/privacy"
                    className="text-primary-600 hover:text-primary-700"
                  >
                    {t('sections.legal.links.privacy')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/terms"
                    className="text-primary-600 hover:text-primary-700"
                  >
                    {t('sections.legal.links.terms')}
                  </Link>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
