import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Search, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

const CATEGORY_KEYS = [
  'all',
  'general',
  'pos',
  'menu',
  'tables',
  'kitchen',
  'qr',
  'subscription',
  'account',
  'notifications',
] as const;

type CategoryKey = (typeof CATEGORY_KEYS)[number];

const FAQPage = () => {
  const { t } = useTranslation('help');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<CategoryKey>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const items = useMemo(() => {
    const raw = t('items', { returnObjects: true });
    return Array.isArray(raw) ? (raw as FaqItem[]) : [];
  }, [t]);

  const filteredItems = useMemo(() => {
    const normalised = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!normalised) return true;
      return (
        item.question.toLocaleLowerCase().includes(normalised) ||
        item.answer.toLocaleLowerCase().includes(normalised)
      );
    });
  }, [items, search, category]);

  const toggle = (id: string) => {
    setOpenId((current) => (current === id ? null : id));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <HelpCircle className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">
            {t('title')}
          </h1>
          <p className="text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('searchPlaceholder')}
          className="w-full ps-10 pe-4 py-3 rounded-xl bg-white border border-slate-200 text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
          aria-label={t('searchPlaceholder')}
        />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {CATEGORY_KEYS.map((key) => {
          const isActive = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={cn(
                'shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors border',
                isActive
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              )}
              aria-pressed={isActive}
            >
              {t(`categories.${key}`)}
            </button>
          );
        })}
      </div>

      {filteredItems.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-slate-400" aria-hidden="true" />
          </div>
          <p className="text-slate-600 font-medium">{t('noResults')}</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {filteredItems.map((item) => {
            const isOpen = openId === item.id;
            return (
              <li
                key={item.id}
                className="bg-white rounded-xl border border-slate-200/60 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggle(item.id)}
                  className="w-full flex items-center justify-between gap-4 px-5 py-4 text-start hover:bg-slate-50 transition-colors"
                  aria-expanded={isOpen}
                  aria-controls={`faq-panel-${item.id}`}
                >
                  <span className="font-medium text-slate-800">
                    {item.question}
                  </span>
                  <ChevronDown
                    className={cn(
                      'w-5 h-5 shrink-0 text-slate-400 transition-transform',
                      isOpen && 'rotate-180'
                    )}
                    aria-hidden="true"
                  />
                </button>
                {isOpen && (
                  <div
                    id={`faq-panel-${item.id}`}
                    className="px-5 pb-5 pt-0 text-slate-600 leading-relaxed border-t border-slate-100"
                  >
                    <p className="pt-4">{item.answer}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default FAQPage;
