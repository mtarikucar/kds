import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import { Save, RotateCcw, Palette, Type, Layout, QrCode, Eye, Sparkles, ChevronDown, ChevronUp, UtensilsCrossed } from 'lucide-react';
import type { QrMenuSettings, UpdateQrSettingsDto } from '../../types';
import QrCodeDisplay from './QrCodeDisplay';
import api from '../../lib/api';
import { MAX_LOGO_SIZE, colorThemes, designTemplates } from './designEditor.constants';
import TemplatesTab from './tabs/TemplatesTab';
import ColorsTab from './tabs/ColorsTab';
import TypographyTab from './tabs/TypographyTab';
import LayoutTab from './tabs/LayoutTab';
import QrTab from './tabs/QrTab';

interface DesignEditorProps {
  settings: QrMenuSettings;
  onUpdate: (updates: UpdateQrSettingsDto) => void;
  isUpdating?: boolean;
  tenant?: { id: string; name: string };
}

const DesignEditor = ({ settings, onUpdate, isUpdating, tenant }: DesignEditorProps) => {
  const { t } = useTranslation('common');
  const [formData, setFormData] = useState<UpdateQrSettingsDto>({
    primaryColor: settings.primaryColor,
    secondaryColor: settings.secondaryColor,
    backgroundColor: settings.backgroundColor,
    fontFamily: settings.fontFamily,
    showRestaurantInfo: settings.showRestaurantInfo,
    showPrices: settings.showPrices,
    showDescription: settings.showDescription,
    showImages: settings.showImages,
    layoutStyle: settings.layoutStyle,
    itemsPerRow: settings.itemsPerRow,
    enableTableQR: settings.enableTableQR,
    tableQRMessage: settings.tableQRMessage,
  });

  const [showColorPicker, setShowColorPicker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'templates' | 'colors' | 'typography' | 'layout' | 'qr'>('templates');
  const [previewMode, setPreviewMode] = useState<'mobile' | 'tablet'>('mobile');
  const [isPreviewExpanded, setIsPreviewExpanded] = useState(true);
  const [previewSelectedCategory, setPreviewSelectedCategory] = useState<string>('');

  useEffect(() => {
    setFormData({
      primaryColor: settings.primaryColor,
      secondaryColor: settings.secondaryColor,
      backgroundColor: settings.backgroundColor,
      fontFamily: settings.fontFamily,
      showRestaurantInfo: settings.showRestaurantInfo,
      showPrices: settings.showPrices,
      showDescription: settings.showDescription,
      showImages: settings.showImages,
      layoutStyle: settings.layoutStyle,
      itemsPerRow: settings.itemsPerRow,
      enableTableQR: settings.enableTableQR,
      tableQRMessage: settings.tableQRMessage,
    });
  }, [settings]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(formData);
  };

  const handleReset = () => {
    setFormData({
      primaryColor: '#3B82F6',
      secondaryColor: '#1F2937',
      backgroundColor: '#F9FAFB',
      fontFamily: 'Inter',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      layoutStyle: 'GRID',
      itemsPerRow: 2,
      enableTableQR: true,
      tableQRMessage: t('admin.scanToViewMenu'),
    });
  };

  const applyTheme = (theme: typeof colorThemes[0]) => {
    setFormData({
      ...formData,
      primaryColor: theme.primary,
      secondaryColor: theme.secondary,
      backgroundColor: theme.background
    });
  };

  const applyTemplate = (template: typeof designTemplates[0]) => {
    setFormData({
      ...formData,
      ...template.settings,
      layoutStyle: template.settings.layoutStyle as 'LIST' | 'GRID' | 'COMPACT',
    });
  };

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Check file size
      if (file.size > MAX_LOGO_SIZE) {
        toast.error(t('common:qrDesigner.logoTooLarge', 'Logo file is too large. Maximum size is 5MB.'));
        e.target.value = '';
        return;
      }

      // Check file type
      if (!file.type.startsWith('image/')) {
        toast.error(t('common:qrDesigner.invalidFileType', 'Please upload an image file.'));
        e.target.value = '';
        return;
      }

      setIsUploadingLogo(true);
      try {
        const formDataUpload = new FormData();
        formDataUpload.append('logo', file);

        const response = await api.post('/upload/logo', formDataUpload, {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        setFormData({ ...formData, logoUrl: response.data.url });
        toast.success(t('common:qrDesigner.logoUploaded', 'Logo uploaded successfully'));
      } catch (error: any) {
        console.error('Logo upload failed:', error);
        toast.error(error.response?.data?.message || t('common:qrDesigner.logoUploadFailed', 'Failed to upload logo'));
      } finally {
        setIsUploadingLogo(false);
        e.target.value = '';
      }
    }
  };

  // Sample data for preview
  const sampleCategories = [
    { id: '1', name: t('common:qrDesigner.sampleCategories.appetizers') },
    { id: '2', name: t('common:qrDesigner.sampleCategories.mainCourses') },
    { id: '3', name: t('common:qrDesigner.sampleCategories.desserts') }
  ];

  const sampleProducts = [
    { id: '1', name: t('common:qrDesigner.sampleProducts.caesarSaladName'), description: t('common:qrDesigner.sampleProducts.caesarSaladDesc'), price: 12.99, categoryId: '1', image: null },
    { id: '2', name: t('common:qrDesigner.sampleProducts.bruschettaName'), description: t('common:qrDesigner.sampleProducts.bruschettaDesc'), price: 9.99, categoryId: '1', image: null },
    { id: '3', name: t('common:qrDesigner.sampleProducts.grilledSalmonName'), description: t('common:qrDesigner.sampleProducts.grilledSalmonDesc'), price: 24.99, categoryId: '2', image: null },
    { id: '4', name: t('common:qrDesigner.sampleProducts.ribeyeSteakName'), description: t('common:qrDesigner.sampleProducts.ribeyeSteakDesc'), price: 32.99, categoryId: '2', image: null },
    { id: '5', name: t('common:qrDesigner.sampleProducts.tiramisuName'), description: t('common:qrDesigner.sampleProducts.tiramisuDesc'), price: 8.99, categoryId: '3', image: null },
    { id: '6', name: t('common:qrDesigner.sampleProducts.lavaCakeName'), description: t('common:qrDesigner.sampleProducts.lavaCakeDesc'), price: 9.99, categoryId: '3', image: null }
  ];

  const filteredPreviewProducts = sampleProducts.filter(
    product => !previewSelectedCategory || product.categoryId === previewSelectedCategory
  );

  return (
    <div className="space-y-6">
      {/* Tab Navigation */}
      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-4">
          {[
            { id: 'templates', label: t('admin.templates'), icon: Sparkles },
            { id: 'colors', label: t('admin.colors'), icon: Palette },
            { id: 'typography', label: t('admin.typography'), icon: Type },
            { id: 'layout', label: t('admin.layout'), icon: Layout },
            { id: 'qr', label: t('admin.qrStyle'), icon: QrCode }
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`
                py-3 px-4 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors
                ${activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                }
              `}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Settings Panel - Left Side */}
        <div className="lg:col-span-2">
          <form onSubmit={handleSubmit} className="space-y-6">
        {/* Templates Tab */}
        {activeTab === 'templates' && (
          <TemplatesTab onApplyTemplate={applyTemplate} />
        )}

        {/* Colors Tab */}
        {activeTab === 'colors' && (
          <ColorsTab
            formData={formData}
            setFormData={setFormData}
            showColorPicker={showColorPicker}
            setShowColorPicker={setShowColorPicker}
            onApplyTheme={applyTheme}
          />
        )}

        {/* Typography Tab */}
        {activeTab === 'typography' && (
          <TypographyTab
            formData={formData}
            setFormData={setFormData}
            isUploadingLogo={isUploadingLogo}
            onLogoUpload={handleLogoUpload}
          />
        )}

        {/* Layout Tab */}
        {activeTab === 'layout' && (
          <LayoutTab formData={formData} setFormData={setFormData} />
        )}

        {/* QR Style Tab */}
        {activeTab === 'qr' && (
          <QrTab formData={formData} setFormData={setFormData} />
        )}

            <div className="flex gap-3 sticky bottom-0 bg-white pt-4 pb-2 border-t border-slate-200">
              <Button
                type="submit"
                variant="primary"
                isLoading={isUpdating}
                className="flex items-center gap-2"
              >
                <Save className="h-4 w-4" />
                {t('common:qrDesigner.saveAllChanges')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleReset}
                className="flex items-center gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                {t('common:qrDesigner.resetToDefaults')}
              </Button>
            </div>
          </form>
        </div>

        {/* Preview Panel - Right Side (Sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-6">
            {/* QR Code Preview */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <QrCode className="h-4 w-4" />
                  {t('admin.qrCodePreview')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-xl border-2 border-slate-200 shadow-inner text-center">
                    <QrCodeDisplay
                      qrCode={{
                        id: 'preview',
                        type: 'TENANT',
                        url: tenant ? `${window.location.origin}/qr-menu/${tenant.id}` : '#',
                        qrDataUrl: '',
                        label: t('common:qrDesigner.mainQRCode')
                      }}
                      tenant={tenant}
                      compact
                      caption={formData.tableQRMessage}
                      settings={{
                        primaryColor: formData.primaryColor,
                        backgroundColor: formData.backgroundColor
                      }}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500">{t('common:qrDesigner.liveQRCodePreview')}</p>
                    <p className="text-xs text-slate-400">{t('common:qrDesigner.updatesAutomatically')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Menu Preview */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    {t('common:qrDesigner.menuPreview')}
                  </CardTitle>
                  <button
                    type="button"
                    onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}
                    className="p-1 hover:bg-slate-100 rounded transition-colors"
                  >
                    {isPreviewExpanded ? (
                      <ChevronUp className="h-4 w-4 text-slate-600" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-600" />
                    )}
                  </button>
                </div>
              </CardHeader>
              {isPreviewExpanded && (
                <CardContent>
                  <div className="space-y-3">
                    {/* Device Mode Selector */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewMode('mobile')}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          previewMode === 'mobile'
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Mobile
                      </button>
                      <button
                        type="button"
                        onClick={() => setPreviewMode('tablet')}
                        className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          previewMode === 'tablet'
                            ? 'bg-primary-600 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Tablet
                      </button>
                    </div>

                    {/* Preview Container */}
                    <div className="border-2 border-slate-300 rounded-lg overflow-hidden">
                      <div
                        className="text-xs text-center py-1"
                        style={{ backgroundColor: formData.backgroundColor }}
                      >
                        <p className="text-slate-600">{t('common:qrDesigner.livePreview')}</p>
                      </div>

                      {/* Actual Menu Preview */}
                      <div
                        className="overflow-y-auto"
                        style={{
                          backgroundColor: formData.backgroundColor,
                          fontFamily: formData.fontFamily,
                          maxHeight: '500px'
                        }}
                      >
                        {/* Header */}
                        <div
                          className="shadow-sm"
                          style={{ backgroundColor: formData.primaryColor }}
                        >
                          <div className="px-3 py-4">
                            {formData.showRestaurantInfo && (
                              <div className="flex items-center gap-2 mb-3">
                                {formData.logoUrl ? (
                                  <img
                                    src={formData.logoUrl}
                                    alt={t('common:qrDesigner.restaurantLogo')}
                                    className="h-8 w-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div
                                    className="h-8 w-8 rounded-full flex items-center justify-center"
                                    style={{ backgroundColor: formData.secondaryColor }}
                                  >
                                    <UtensilsCrossed className="h-4 w-4 text-white" />
                                  </div>
                                )}
                                <h1 className="text-base font-bold text-white">
                                  {tenant?.name || t('common:qrDesigner.restaurantName')}
                                </h1>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="px-3 py-3">
                          {/* Categories */}
                          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                            <button
                              type="button"
                              onClick={() => setPreviewSelectedCategory('')}
                              className="px-2.5 py-1 rounded-full whitespace-nowrap border text-xs transition-colors"
                              style={{
                                backgroundColor: !previewSelectedCategory ? formData.primaryColor : 'white',
                                color: !previewSelectedCategory ? 'white' : formData.secondaryColor,
                                borderColor: formData.primaryColor,
                              }}
                            >
                              {t('common:qrDesigner.all')}
                            </button>
                            {sampleCategories.map((category) => (
                              <button
                                key={category.id}
                                type="button"
                                onClick={() => setPreviewSelectedCategory(category.id)}
                                className="px-2.5 py-1 rounded-full whitespace-nowrap border text-xs transition-colors"
                                style={{
                                  backgroundColor: previewSelectedCategory === category.id ? formData.primaryColor : 'white',
                                  color: previewSelectedCategory === category.id ? 'white' : formData.secondaryColor,
                                  borderColor: formData.primaryColor,
                                }}
                              >
                                {category.name}
                              </button>
                            ))}
                          </div>

                          {/* Products based on layout */}
                          {formData.layoutStyle === 'LIST' && (
                            <div className="space-y-2">
                              {filteredPreviewProducts.map((product) => (
                                <div key={product.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                                  <div className="flex gap-2">
                                    {formData.showImages && (
                                      <div className="w-20 h-20 bg-slate-200 flex-shrink-0" />
                                    )}
                                    <div className="flex-1 p-2">
                                      <h3
                                        className="text-sm font-semibold"
                                        style={{ color: formData.secondaryColor }}
                                      >
                                        {product.name}
                                      </h3>
                                      {formData.showDescription && (
                                        <p className="text-xs text-slate-600 mt-0.5 line-clamp-1">
                                          {product.description}
                                        </p>
                                      )}
                                      {formData.showPrices && (
                                        <p
                                          className="text-sm font-bold mt-1"
                                          style={{ color: formData.primaryColor }}
                                        >
                                          ${product.price.toFixed(2)}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {formData.layoutStyle === 'GRID' && (
                            <div
                              className="grid gap-2"
                              style={{
                                gridTemplateColumns: `repeat(${formData.itemsPerRow}, minmax(0, 1fr))`
                              }}
                            >
                              {filteredPreviewProducts.map((product) => (
                                <div key={product.id} className="bg-white rounded-lg shadow-sm overflow-hidden">
                                  {formData.showImages && (
                                    <div className="w-full h-20 bg-slate-200" />
                                  )}
                                  <div className="p-2">
                                    <h3
                                      className="text-xs font-semibold"
                                      style={{ color: formData.secondaryColor }}
                                    >
                                      {product.name}
                                    </h3>
                                    {formData.showDescription && (
                                      <p className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                                        {product.description}
                                      </p>
                                    )}
                                    {formData.showPrices && (
                                      <p
                                        className="text-xs font-bold mt-1"
                                        style={{ color: formData.primaryColor }}
                                      >
                                        ${product.price.toFixed(2)}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {formData.layoutStyle === 'COMPACT' && (
                            <div className="space-y-1">
                              {filteredPreviewProducts.map((product) => (
                                <div key={product.id} className="bg-white rounded shadow-sm p-2 flex justify-between items-center">
                                  <h3
                                    className="text-xs font-semibold"
                                    style={{ color: formData.secondaryColor }}
                                  >
                                    {product.name}
                                  </h3>
                                  {formData.showPrices && (
                                    <p
                                      className="text-xs font-bold"
                                      style={{ color: formData.primaryColor }}
                                    >
                                      ${product.price.toFixed(2)}
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="text-center">
                      <p className="text-xs text-slate-500">{t('common:qrDesigner.liveMenuPreview')}</p>
                      <p className="text-xs text-slate-400">{t('common:qrDesigner.updatesAutomaticallyWithChanges')}</p>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Color Swatches */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-4 w-4" />
                  {t('common:qrDesigner.currentColors')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-lg border-2 border-slate-300 shadow-sm" 
                      style={{ backgroundColor: formData.primaryColor }}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t('common:qrDesigner.primary')}</p>
                      <p className="text-xs text-slate-500 font-mono">{formData.primaryColor}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-lg border-2 border-slate-300 shadow-sm" 
                      style={{ backgroundColor: formData.secondaryColor }}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t('common:qrDesigner.secondary')}</p>
                      <p className="text-xs text-slate-500 font-mono">{formData.secondaryColor}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-8 h-8 rounded-lg border-2 border-slate-300 shadow-sm" 
                      style={{ backgroundColor: formData.backgroundColor }}
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{t('common:qrDesigner.background')}</p>
                      <p className="text-xs text-slate-500 font-mono">{formData.backgroundColor}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DesignEditor;
