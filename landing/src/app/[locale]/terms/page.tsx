'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';

export default function TermsOfServicePage() {
  const t = useTranslations('terms');

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
          <p className="text-slate-500 mb-12">
            {t('lastUpdated')}: {t('lastUpdatedDate')}
          </p>

          <div className="prose prose-slate max-w-none">
            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.acceptance.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.acceptance.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.description.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.description.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.account.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                {t('sections.account.content')}
              </p>
              <ul className="list-disc list-inside text-slate-600 space-y-2">
                <li>{t('sections.account.items.accurate')}</li>
                <li>{t('sections.account.items.security')}</li>
                <li>{t('sections.account.items.notify')}</li>
                <li>{t('sections.account.items.responsible')}</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.usage.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                {t('sections.usage.content')}
              </p>
              <ul className="list-disc list-inside text-slate-600 space-y-2">
                <li>{t('sections.usage.items.lawful')}</li>
                <li>{t('sections.usage.items.noHarm')}</li>
                <li>{t('sections.usage.items.noViolate')}</li>
                <li>{t('sections.usage.items.noReverse')}</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.payment.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.payment.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.intellectual.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.intellectual.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.termination.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.termination.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.liability.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.liability.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.changes.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.changes.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.contact.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.contact.content')}
              </p>
              <p className="text-slate-600 mt-4">
                Email: info@hummytummy.com
              </p>
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
