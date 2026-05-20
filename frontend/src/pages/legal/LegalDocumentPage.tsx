import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import { ArrowLeft, ChefHat } from 'lucide-react';
import {
  LegalDocumentKind,
  useGetCurrentLegalDocument,
} from '../../features/legal/legalApi';

interface LegalDocumentPageProps {
  kind: LegalDocumentKind;
}

/**
 * Shared shell for the three checkout-mandatory legal pages
 * (/legal/kvkk, /legal/distance-sales, /legal/refund). Each route
 * imports this with its `kind`; the page fetches the current version
 * from `GET /legal/documents/:kind/current` and renders the Markdown
 * body. Uniform header + back link match the existing
 * TermsOfServicePage / PrivacyPolicyPage chrome.
 */
const LegalDocumentPage: React.FC<LegalDocumentPageProps> = ({ kind }) => {
  const { t, i18n } = useTranslation('legal');
  const { data: doc, isLoading, isError } = useGetCurrentLegalDocument(
    kind,
    i18n.language || 'tr',
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-primary-600 hover:text-primary-700"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-medium">{t('backToHome', 'Ana sayfaya dön')}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ChefHat className="w-6 h-6 text-primary-600" />
            <span className="font-bold text-slate-900">HummyTummy</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10">
        {isLoading && (
          <div className="text-slate-500">{t('loading', 'Yükleniyor...')}</div>
        )}
        {isError && (
          <div className="text-red-600">
            {t(
              'fetchFailed',
              'Belge yüklenemedi. Lütfen sayfayı yenileyin veya daha sonra tekrar deneyin.',
            )}
          </div>
        )}
        {doc && (
          <article>
            <h1 className="text-3xl font-bold text-slate-900 mb-2">{doc.title}</h1>
            <p className="text-sm text-slate-500 mb-8">
              {t('versionLabel', 'Versiyon')} {doc.version} ·{' '}
              {t('effectiveFrom', 'Yürürlük')}:{' '}
              {new Date(doc.effectiveAt).toLocaleDateString(i18n.language || 'tr', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </p>
            <div
              className="prose prose-slate max-w-none
                         prose-headings:text-slate-900
                         prose-p:text-slate-700
                         prose-strong:text-slate-900
                         prose-a:text-primary-600 hover:prose-a:text-primary-700
                         prose-li:text-slate-700"
            >
              <ReactMarkdown>{doc.bodyMarkdown}</ReactMarkdown>
            </div>
          </article>
        )}
      </main>
    </div>
  );
};

export default LegalDocumentPage;
