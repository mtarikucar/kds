import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/Card';
import type { UpdateQrSettingsDto } from '../../../types';

interface LayoutTabProps {
  formData: UpdateQrSettingsDto;
  setFormData: React.Dispatch<React.SetStateAction<UpdateQrSettingsDto>>;
}

/**
 * Presentational "Layout" tab — layout-style selector, items-per-row (grid
 * only), and the display-option checkboxes. Extracted verbatim from
 * DesignEditor's `activeTab === 'layout'` branch; all state stays in the parent.
 */
const LayoutTab = ({ formData, setFormData }: LayoutTabProps) => {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common:qrDesigner.layoutDisplayOptions')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">{t('common:qrDesigner.layoutStyle')}</label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'GRID', label: t('common:qrDesigner.gridView'), description: t('common:qrDesigner.gridDesc') },
              { value: 'LIST', label: t('common:qrDesigner.listView'), description: t('common:qrDesigner.listDesc') },
              { value: 'COMPACT', label: t('common:qrDesigner.compact'), description: t('common:qrDesigner.compactDesc') }
            ].map((style) => (
              <button
                key={style.value}
                type="button"
                onClick={() => setFormData({ ...formData, layoutStyle: style.value as any })}
                className={`p-4 rounded-lg border-2 text-left transition-all ${
                  formData.layoutStyle === style.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className="font-medium text-slate-900">{style.label}</p>
                <p className="text-xs text-slate-500 mt-1">{style.description}</p>
              </button>
            ))}
          </div>
        </div>

        {formData.layoutStyle === 'GRID' && (
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">{t('common:qrDesigner.itemsPerRow')}</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => setFormData({ ...formData, itemsPerRow: num })}
                  className={`px-6 py-2 rounded-lg font-medium transition-all ${
                    formData.itemsPerRow === num
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-700">{t('common:qrDesigner.displayOptions')}</p>
          <div className="space-y-2">
            {[
              { key: 'showRestaurantInfo', label: t('common:qrDesigner.showRestaurantInfo') },
              { key: 'showPrices', label: t('common:qrDesigner.showPrices') },
              { key: 'showDescription', label: t('common:qrDesigner.showDescriptions') },
              { key: 'showImages', label: t('common:qrDesigner.showImages') }
            ].map((option) => (
              <label key={option.key} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={formData[option.key as keyof typeof formData] as boolean}
                  onChange={(e) => setFormData({ ...formData, [option.key]: e.target.checked })}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-slate-700">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default LayoutTab;
