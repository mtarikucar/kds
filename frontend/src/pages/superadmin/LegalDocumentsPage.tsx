import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, Plus, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  LegalDocument,
  LegalDocumentKind,
  useListLegalDocuments,
  usePublishLegalDocument,
} from '../../features/legal/legalApi';

const KIND_LABELS: Record<LegalDocumentKind, string> = {
  KVKK: 'KVKK Aydınlatma Metni',
  DISTANCE_SALES: 'Mesafeli Satış Sözleşmesi',
  REFUND_POLICY: 'İade ve Cayma Politikası',
  TERMS_OF_SERVICE: 'Kullanım Koşulları',
  PRIVACY_POLICY: 'Gizlilik Politikası',
};

const PUBLISH_KINDS: LegalDocumentKind[] = [
  'KVKK',
  'DISTANCE_SALES',
  'REFUND_POLICY',
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
];

/**
 * SuperAdmin-only page for managing the platform's legal documents.
 * Two surfaces:
 *
 *   - Top: a table of every (kind, version, locale) row, isCurrent
 *     highlighted. Click a row to preview the markdown inline.
 *   - "Yeni versiyon yayınla" button opens a modal with kind/version/
 *     locale/title fields and a Markdown textarea (with live preview).
 *     Submitting calls POST /superadmin/legal/documents/publish — the
 *     backend atomically de-activates the previous current row and
 *     marks the new one current. Tenants get the new text immediately
 *     on their next page load.
 */
export default function LegalDocumentsPage() {
  const { t } = useTranslation('superadmin');
  const { data: docs, isLoading } = useListLegalDocuments();
  const publishMutation = usePublishLegalDocument();
  const [expandedDocId, setExpandedDocId] = useState<string | null>(null);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const docsByKind = useMemo(() => {
    const acc: Record<string, LegalDocument[]> = {};
    for (const d of docs ?? []) {
      (acc[d.kind] ??= []).push(d);
    }
    return acc;
  }, [docs]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('legal.title')}</h1>
          <p className="text-sm text-slate-600 mt-1">
            {t('legal.subtitle')}
          </p>
        </div>
        <button
          onClick={() => setShowPublishModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />
          {t('legal.publishNewVersion')}
        </button>
      </div>

      {isLoading && <div className="text-slate-500">{t('legal.loading')}</div>}

      {!isLoading && Object.keys(docsByKind).length === 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center text-slate-500">
          {t('legal.empty')}
        </div>
      )}

      {Object.entries(docsByKind).map(([kind, items]) => (
        <section key={kind} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <header className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
            <FileText className="w-4 h-4 text-slate-600" />
            <h2 className="font-semibold text-slate-900">
              {t(`legal.kindLabels.${kind}`, KIND_LABELS[kind as LegalDocumentKind] ?? kind)}
            </h2>
            <span className="text-xs text-slate-500">{t('legal.versionCount', { count: items.length })}</span>
          </header>
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-2 text-left">{t('legal.col.version')}</th>
                <th className="px-4 py-2 text-left">{t('legal.col.language')}</th>
                <th className="px-4 py-2 text-left">{t('legal.col.effective')}</th>
                <th className="px-4 py-2 text-left">{t('legal.col.status')}</th>
                <th className="px-4 py-2 text-right">{t('legal.col.action')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tbody key={d.id}>
                  <tr className="border-b border-slate-100">
                    <td className="px-4 py-2 font-mono text-xs">{d.version}</td>
                    <td className="px-4 py-2">{d.locale}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {new Date(d.effectiveAt).toLocaleDateString('tr-TR')}
                    </td>
                    <td className="px-4 py-2">
                      {d.isCurrent ? (
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                          {t('legal.active')}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">{t('legal.past')}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() =>
                          setExpandedDocId(expandedDocId === d.id ? null : d.id)
                        }
                        className="text-primary-600 hover:text-primary-700 text-sm"
                      >
                        {expandedDocId === d.id ? t('legal.hide') : t('legal.preview')}
                      </button>
                    </td>
                  </tr>
                  {expandedDocId === d.id && (
                    <tr>
                      <td colSpan={5} className="px-4 py-4 bg-slate-50">
                        <div className="text-xs font-medium text-slate-500 mb-2">
                          {d.title}
                        </div>
                        <div className="prose prose-sm prose-slate max-w-none">
                          <ReactMarkdown>{d.bodyMarkdown}</ReactMarkdown>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {showPublishModal && (
        <PublishModal
          onClose={() => setShowPublishModal(false)}
          onPublished={() => setShowPublishModal(false)}
          publishMutation={publishMutation}
        />
      )}
    </div>
  );
}

interface PublishModalProps {
  onClose: () => void;
  onPublished: () => void;
  publishMutation: ReturnType<typeof usePublishLegalDocument>;
}

function PublishModal({ onClose, onPublished, publishMutation }: PublishModalProps) {
  const { t } = useTranslation('superadmin');
  const [form, setForm] = useState({
    kind: 'KVKK' as LegalDocumentKind,
    version: '',
    locale: 'tr',
    title: '',
    bodyMarkdown: '',
  });
  const [showPreview, setShowPreview] = useState(false);

  const canSubmit =
    form.version.match(/^\d+\.\d+(\.\d+)?$/) &&
    form.title.trim().length > 0 &&
    form.bodyMarkdown.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await publishMutation.mutateAsync(form);
    onPublished();
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">{t('legal.publishNewVersion')}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('legal.modal.kind')}</span>
              <select
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as LegalDocumentKind })}
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
              >
                {PUBLISH_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`legal.kindLabels.${k}`, KIND_LABELS[k])}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('legal.modal.version')}</span>
              <input
                value={form.version}
                onChange={(e) => setForm({ ...form, version: e.target.value })}
                placeholder="1.1"
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-700">{t('legal.modal.language')}</span>
              <input
                value={form.locale}
                onChange={(e) => setForm({ ...form, locale: e.target.value })}
                placeholder="tr"
                className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-700">{t('legal.modal.title')}</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={t('legal.modal.titlePlaceholder')}
              className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-md text-sm"
            />
          </label>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-700">{t('legal.modal.content')}</span>
              <button
                onClick={() => setShowPreview((p) => !p)}
                className="text-xs text-primary-600 hover:text-primary-700"
              >
                {showPreview ? t('legal.modal.backToEditor') : t('legal.modal.previewToggle')}
              </button>
            </div>
            {showPreview ? (
              <div className="border border-slate-300 rounded-md p-4 prose prose-sm prose-slate max-w-none min-h-[400px]">
                <ReactMarkdown>{form.bodyMarkdown || t('legal.modal.empty')}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                value={form.bodyMarkdown}
                onChange={(e) => setForm({ ...form, bodyMarkdown: e.target.value })}
                rows={20}
                placeholder={t('legal.modal.contentPlaceholder')}
                className="w-full px-3 py-2 border border-slate-300 rounded-md text-sm font-mono"
              />
            )}
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 hover:bg-slate-200 rounded-md text-sm"
          >
            {t('legal.modal.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || publishMutation.isPending}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-md text-sm font-medium"
          >
            {publishMutation.isPending ? t('legal.modal.publishing') : t('legal.modal.publish')}
          </button>
        </footer>
      </div>
    </div>
  );
}
