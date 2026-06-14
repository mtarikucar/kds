import { useTranslation } from 'react-i18next';
import { Upload, Loader2 } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/Card';
import type { UpdateQrSettingsDto } from '../../../types';
import { fontOptions } from '../designEditor.constants';

interface TypographyTabProps {
  formData: UpdateQrSettingsDto;
  setFormData: React.Dispatch<React.SetStateAction<UpdateQrSettingsDto>>;
  isUploadingLogo: boolean;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

/**
 * Presentational "Typography" tab — font picker grid + logo upload area.
 * Extracted verbatim from DesignEditor's `activeTab === 'typography'` branch.
 * The upload side-effect (validation + API call) stays in the parent and is
 * passed in as onLogoUpload; isUploadingLogo state also lives in the parent.
 */
const TypographyTab = ({ formData, setFormData, isUploadingLogo, onLogoUpload }: TypographyTabProps) => {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('common:qrDesigner.typographySettings')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">{t('common:qrDesigner.fontFamily')}</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {fontOptions.map((font) => (
              <button
                key={font.value}
                type="button"
                onClick={() => setFormData({ ...formData, fontFamily: font.value })}
                className={`p-4 rounded-lg border-2 transition-all ${
                  formData.fontFamily === font.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <p className={`text-lg ${font.className} font-medium`}>{font.label}</p>
                <p className="text-xs text-slate-500 mt-1">{t('common:qrDesigner.sampleText')}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-3">{t('common:qrDesigner.logoUpload')}</label>
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-slate-400 transition-colors">
            {isUploadingLogo ? (
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 text-blue-600 animate-spin mb-2" />
                <p className="text-sm text-slate-600">{t('common:qrDesigner.uploadingLogo', 'Uploading...')}</p>
              </div>
            ) : (
              <>
                <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-600 mb-2">{t('common:qrDesigner.uploadLogo')}</p>
                <p className="text-xs text-slate-400 mb-3">{t('common:qrDesigner.maxFileSize', 'Max file size: 5MB')}</p>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onLogoUpload}
                  className="hidden"
                  id="logo-upload"
                  disabled={isUploadingLogo}
                />
                <label
                  htmlFor="logo-upload"
                  className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700"
                >
                  {t('common:qrDesigner.chooseFile')}
                </label>
              </>
            )}
            {formData.logoUrl && (
              <div className="mt-4">
                <img src={formData.logoUrl} alt={t('common:qrDesigner.logoPreview')} className="h-16 mx-auto rounded-lg" />
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default TypographyTab;
