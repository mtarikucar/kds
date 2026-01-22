import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { HexColorPicker } from 'react-colorful';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Save, RotateCcw, Palette, Type, Layout, QrCode, Eye, Upload, Sparkles, ChevronDown, ChevronUp, UtensilsCrossed, Loader2 } from 'lucide-react';
import type { QrMenuSettings, UpdateQrSettingsDto } from '../../types';
import QrCodeDisplay from './QrCodeDisplay';
import api from '../../lib/api';

// Max file size for logo upload (5MB)
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

interface DesignEditorProps {
  settings: QrMenuSettings;
  onUpdate: (updates: UpdateQrSettingsDto) => void;
  isUpdating?: boolean;
  tenant?: { id: string; name: string };
}

const colorThemes = [
  { id: 'modernBlue', name: 'Modern Blue', primary: '#3B82F6', secondary: '#1E40AF', background: '#F0F9FF' },
  { id: 'elegantDark', name: 'Elegant Dark', primary: '#1F2937', secondary: '#111827', background: '#F9FAFB' },
  { id: 'warmOrange', name: 'Warm Orange', primary: '#F97316', secondary: '#EA580C', background: '#FFF7ED' },
  { id: 'freshGreen', name: 'Fresh Green', primary: '#10B981', secondary: '#059669', background: '#F0FDF4' },
  { id: 'royalPurple', name: 'Royal Purple', primary: '#8B5CF6', secondary: '#7C3AED', background: '#FAF5FF' },
  { id: 'classicRed', name: 'Classic Red', primary: '#EF4444', secondary: '#DC2626', background: '#FEF2F2' }
];

const designTemplates = [
  {
    id: 'fineDining',
    name: 'Fine Dining',
    description: 'Elegant and sophisticated design',
    preview: '🍽️',
    settings: {
      primaryColor: '#1F2937',
      secondaryColor: '#111827',
      backgroundColor: '#F9FAFB',
      fontFamily: 'Playfair Display',
      layoutStyle: 'LIST',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 1
    }
  },
  {
    id: 'modernCafe',
    name: 'Modern Cafe',
    description: 'Clean and minimal design',
    preview: '☕',
    settings: {
      primaryColor: '#3B82F6',
      secondaryColor: '#1E40AF',
      backgroundColor: '#F0F9FF',
      fontFamily: 'Inter',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: false,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'fastFood',
    name: 'Fast Food',
    description: 'Vibrant and energetic design',
    preview: '🍔',
    settings: {
      primaryColor: '#EF4444',
      secondaryColor: '#DC2626',
      backgroundColor: '#FEF2F2',
      fontFamily: 'Montserrat',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: false,
      showImages: true,
      itemsPerRow: 3
    }
  },
  {
    id: 'healthyFresh',
    name: 'Healthy & Fresh',
    description: 'Natural and organic feel',
    preview: '🥗',
    settings: {
      primaryColor: '#10B981',
      secondaryColor: '#059669',
      backgroundColor: '#F0FDF4',
      fontFamily: 'Open Sans',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'pizzaPlace',
    name: 'Pizza Place',
    description: 'Warm and inviting design',
    preview: '🍕',
    settings: {
      primaryColor: '#F97316',
      secondaryColor: '#EA580C',
      backgroundColor: '#FFF7ED',
      fontFamily: 'Roboto',
      layoutStyle: 'GRID',
      showRestaurantInfo: true,
      showPrices: true,
      showDescription: true,
      showImages: true,
      itemsPerRow: 2
    }
  },
  {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Simple black and white',
    preview: '⚫',
    settings: {
      primaryColor: '#000000',
      secondaryColor: '#374151',
      backgroundColor: '#FFFFFF',
      fontFamily: 'Inter',
      layoutStyle: 'LIST',
      showRestaurantInfo: false,
      showPrices: true,
      showDescription: false,
      showImages: false,
      itemsPerRow: 1
    }
  }
];

const fontOptions = [
  { value: 'Inter', label: 'Inter', className: 'font-sans' },
  { value: 'Roboto', label: 'Roboto', className: 'font-sans' },
  { value: 'Open Sans', label: 'Open Sans', className: 'font-sans' },
  { value: 'Playfair Display', label: 'Playfair Display', className: 'font-serif' },
  { value: 'Merriweather', label: 'Merriweather', className: 'font-serif' },
  { value: 'Montserrat', label: 'Montserrat', className: 'font-sans' }
];

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

  const ColorPickerButton = ({ label, colorKey }: { label: string; colorKey: string }) => (
    <div className="relative">
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setShowColorPicker(showColorPicker === colorKey ? null : colorKey)}
        className="w-full h-10 rounded border-2 border-slate-300 flex items-center gap-2 px-3 hover:border-blue-500"
      >
        <div
          className="w-6 h-6 rounded border border-slate-300"
          style={{ backgroundColor: formData[colorKey as keyof typeof formData] as string }}
        />
        <span className="text-sm font-mono">{formData[colorKey as keyof typeof formData]}</span>
      </button>
      {showColorPicker === colorKey && (
        <div className="absolute z-10 mt-2">
          <div
            className="fixed inset-0"
            onClick={() => setShowColorPicker(null)}
          />
          <div className="relative bg-white p-3 rounded-lg shadow-lg border border-slate-200">
            <HexColorPicker
              color={formData[colorKey as keyof typeof formData] as string}
              onChange={(color) => setFormData({ ...formData, [colorKey]: color })}
            />
          </div>
        </div>
      )}
    </div>
  );

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
                  ? 'border-blue-500 text-blue-600'
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
                    onClick={() => applyTemplate(template)}
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
        )}

        {/* Colors Tab */}
        {activeTab === 'colors' && (
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
                      onClick={() => applyTheme(theme)}
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
                  <ColorPickerButton label={t('common:qrDesigner.primaryColor')} colorKey="primaryColor" />
                  <ColorPickerButton label={t('common:qrDesigner.secondaryColor')} colorKey="secondaryColor" />
                  <ColorPickerButton label={t('common:qrDesigner.backgroundColor')} colorKey="backgroundColor" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Typography Tab */}
        {activeTab === 'typography' && (
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
                        onChange={handleLogoUpload}
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
        )}

        {/* Layout Tab */}
        {activeTab === 'layout' && (
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
        )}

        {/* QR Style Tab */}
        {activeTab === 'qr' && (
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
                            ? 'bg-blue-600 text-white'
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
                            ? 'bg-blue-600 text-white'
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
