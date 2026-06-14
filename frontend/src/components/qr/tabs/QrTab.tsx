import { useTranslation } from 'react-i18next';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/Card';
import Input from '../../ui/Input';
import type { UpdateQrSettingsDto } from '../../../types';

interface QrTabProps {
  formData: UpdateQrSettingsDto;
  setFormData: React.Dispatch<React.SetStateAction<UpdateQrSettingsDto>>;
}

/**
 * Presentational "QR Style" tab — table-QR toggle, optional message input, and
 * the static color preview. Extracted verbatim from DesignEditor's
 * `activeTab === 'qr'` branch; all state stays in the parent.
 */
const QrTab = ({ formData, setFormData }: QrTabProps) => {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.qrCodeCustomization')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <p className="text-sm font-medium text-slate-700">{t('admin.tableQRCodes')}</p>
          <label className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50">
            <input
              type="checkbox"
              checked={formData.enableTableQR}
              onChange={(e) => setFormData({ ...formData, enableTableQR: e.target.checked })}
              className="rounded border-slate-300 text-blue-600"
            />
            <div>
              <span className="text-sm font-medium text-slate-700">{t('admin.enableTableQR')}</span>
              <p className="text-xs text-slate-500">{t('admin.enableTableQRDesc')}</p>
            </div>
          </label>

          {formData.enableTableQR && (
            <div className="ml-6 space-y-4">
              <Input
                label={t('common:qrDesigner.tableQRMessage')}
                type="text"
                value={formData.tableQRMessage}
                onChange={(e) => setFormData({ ...formData, tableQRMessage: e.target.value })}
                placeholder={t('admin.scanToViewMenu')}
              />
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs font-medium text-blue-900 mb-1">{t('common:qrDesigner.proTip')}</p>
                <p className="text-xs text-blue-800">
                  {t('common:qrDesigner.proTipText')}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-slate-200">
          <p className="text-sm font-medium text-slate-700 mb-3">{t('common:qrDesigner.qrCodePreview')}</p>
          <div className="bg-slate-50 rounded-lg p-4 text-center">
            <p className="text-xs text-slate-500 mb-2">{t('common:qrDesigner.qrWillUseColors')}</p>
            <div className="flex justify-center gap-4">
              <div className="text-center">
                <div
                  className="w-16 h-16 rounded-lg border-2 border-slate-300 mb-1"
                  style={{ backgroundColor: formData.primaryColor }}
                />
                <p className="text-xs text-slate-600">{t('common:qrDesigner.qrPattern')}</p>
              </div>
              <div className="text-center">
                <div
                  className="w-16 h-16 rounded-lg border-2 border-slate-300 mb-1"
                  style={{ backgroundColor: formData.backgroundColor }}
                />
                <p className="text-xs text-slate-600">{t('common:qrDesigner.background')}</p>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default QrTab;
