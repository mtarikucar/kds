import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '../../ui/Card';
import { designTemplates } from '../designEditor.constants';

interface TemplatesTabProps {
  /** Apply a template's settings into the parent formData. */
  onApplyTemplate: (template: (typeof designTemplates)[number]) => void;
}

/**
 * Presentational "Templates" tab — pure render of the template gallery.
 * Extracted verbatim from DesignEditor's `activeTab === 'templates'` branch;
 * the only prop is the apply handler, all state remains in the parent.
 */
const TemplatesTab = ({ onApplyTemplate }: TemplatesTabProps) => {
  const { t } = useTranslation('common');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          {t('admin.designTemplates')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-slate-600 mb-4">
          {t('admin.choosePreDesignedTemplate')}
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {designTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onApplyTemplate(template)}
              className="p-4 rounded-lg border-2 border-slate-200 hover:border-blue-500 transition-all hover:shadow-md text-left"
            >
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{template.preview}</span>
                <div className="flex gap-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: template.settings.primaryColor }} />
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: template.settings.secondaryColor }} />
                  <div className="w-3 h-3 rounded-full border border-slate-300" style={{ backgroundColor: template.settings.backgroundColor }} />
                </div>
              </div>
              <p className="font-semibold text-slate-900 mb-1">{t(`common:qrDesigner.templates.${template.id}.name`)}</p>
              <p className="text-xs text-slate-600">{t(`common:qrDesigner.templates.${template.id}.description`)}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>{template.settings.layoutStyle}</span>
                <span>•</span>
                <span>{template.settings.fontFamily}</span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default TemplatesTab;
