import { useTranslation } from 'react-i18next';
import { Palette } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/Card';
import type { UpdateQrSettingsDto } from '../../../types';
import { colorThemes } from '../designEditor.constants';
import ColorPickerButton from '../ColorPickerButton';

interface ColorsTabProps {
  formData: UpdateQrSettingsDto;
  setFormData: React.Dispatch<React.SetStateAction<UpdateQrSettingsDto>>;
  /** Which color slot's popover is open, or null. */
  showColorPicker: string | null;
  setShowColorPicker: React.Dispatch<React.SetStateAction<string | null>>;
  /** Apply a quick theme's three colors into the parent formData. */
  onApplyTheme: (theme: (typeof colorThemes)[number]) => void;
}

/**
 * Presentational "Colors" tab — quick theme grid + the three custom color
 * pickers. Extracted verbatim from DesignEditor's `activeTab === 'colors'`
 * branch; formData/showColorPicker state continue to live in the parent and are
 * threaded through props.
 */
const ColorsTab = ({
  formData,
  setFormData,
  showColorPicker,
  setShowColorPicker,
  onApplyTheme,
}: ColorsTabProps) => {
  const { t } = useTranslation('common');
  return (
    <div className="space-y-6">

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            {t('common:qrDesigner.quickColorThemes')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {colorThemes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => onApplyTheme(theme)}
                className="p-3 rounded-lg border-2 border-slate-200 hover:border-blue-500 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex gap-1">
                    <div className="w-5 h-5 rounded" style={{ backgroundColor: theme.primary }} />
                    <div className="w-5 h-5 rounded" style={{ backgroundColor: theme.secondary }} />
                    <div className="w-5 h-5 rounded border border-slate-200" style={{ backgroundColor: theme.background }} />
                  </div>
                </div>
                <p className="text-sm font-medium text-slate-700">{t(`common:qrDesigner.themes.${theme.id}`)}</p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('common:qrDesigner.customColors')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ColorPickerButton
              label={t('common:qrDesigner.primaryColor')}
              value={formData.primaryColor as string}
              isOpen={showColorPicker === 'primaryColor'}
              onToggle={() => setShowColorPicker(showColorPicker === 'primaryColor' ? null : 'primaryColor')}
              onClose={() => setShowColorPicker(null)}
              onChange={(color) => setFormData({ ...formData, primaryColor: color })}
            />
            <ColorPickerButton
              label={t('common:qrDesigner.secondaryColor')}
              value={formData.secondaryColor as string}
              isOpen={showColorPicker === 'secondaryColor'}
              onToggle={() => setShowColorPicker(showColorPicker === 'secondaryColor' ? null : 'secondaryColor')}
              onClose={() => setShowColorPicker(null)}
              onChange={(color) => setFormData({ ...formData, secondaryColor: color })}
            />
            <ColorPickerButton
              label={t('common:qrDesigner.backgroundColor')}
              value={formData.backgroundColor as string}
              isOpen={showColorPicker === 'backgroundColor'}
              onToggle={() => setShowColorPicker(showColorPicker === 'backgroundColor' ? null : 'backgroundColor')}
              onClose={() => setShowColorPicker(null)}
              onChange={(color) => setFormData({ ...formData, backgroundColor: color })}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ColorsTab;
