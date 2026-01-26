'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import Navbar from '@/components/layout/Navbar';
import Footer from '@/components/sections/Footer';

export default function PrivacyPolicyPage() {
  const t = useTranslations('privacy');

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
                {t('sections.introduction.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.introduction.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.dataCollection.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                {t('sections.dataCollection.content')}
              </p>
              <ul className="list-disc list-inside text-slate-600 space-y-2">
                <li>{t('sections.dataCollection.items.name')}</li>
                <li>{t('sections.dataCollection.items.email')}</li>
                <li>{t('sections.dataCollection.items.phone')}</li>
                <li>{t('sections.dataCollection.items.business')}</li>
                <li>{t('sections.dataCollection.items.usage')}</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.dataUsage.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                {t('sections.dataUsage.content')}
              </p>
              <ul className="list-disc list-inside text-slate-600 space-y-2">
                <li>{t('sections.dataUsage.items.service')}</li>
                <li>{t('sections.dataUsage.items.improve')}</li>
                <li>{t('sections.dataUsage.items.communicate')}</li>
                <li>{t('sections.dataUsage.items.security')}</li>
              </ul>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.dataSecurity.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.dataSecurity.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.cookies.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.cookies.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.thirdParty.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed">
                {t('sections.thirdParty.content')}
              </p>
            </section>

            <section className="mb-12">
              <h2 className="text-xl font-semibold text-slate-900 mb-4">
                {t('sections.rights.title')}
              </h2>
              <p className="text-slate-600 leading-relaxed mb-4">
                {t('sections.rights.content')}
              </p>
              <ul className="list-disc list-inside text-slate-600 space-y-2">
                <li>{t('sections.rights.items.access')}</li>
                <li>{t('sections.rights.items.rectification')}</li>
                <li>{t('sections.rights.items.erasure')}</li>
                <li>{t('sections.rights.items.restriction')}</li>
                <li>{t('sections.rights.items.portability')}</li>
              </ul>
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
