import { useState, useEffect } from 'react';
import { HexColorPicker } from 'react-colorful';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/Card';
import Button from '../ui/Button';
import Input from '../ui/Input';
import { Save, RotateCcw } from 'lucide-react';
import type { QrMenuSettings, UpdateQrSettingsDto } from '../../types';

interface DesignEditorProps {
  settings: QrMenuSettings;
  onUpdate: (updates: UpdateQrSettingsDto) => void;
  isUpdating?: boolean;
}

const DesignEditor = ({ settings, onUpdate, isUpdating }: DesignEditorProps) => {
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
      tableQRMessage: 'Scan to view our menu',
    });
  };

  const ColorPickerButton = ({ label, colorKey }: { label: string; colorKey: string }) => (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <button
        type="button"
        onClick={() => setShowColorPicker(showColorPicker === colorKey ? null : colorKey)}
        className="w-full h-10 rounded border-2 border-gray-300 flex items-center gap-2 px-3 hover:border-blue-500"
      >
        <div
          className="w-6 h-6 rounded border border-gray-300"
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
          <div className="relative bg-white p-3 rounded-lg shadow-lg border border-gray-200">
            <HexColorPicker
              color={formData[colorKey as keyof typeof formData] as string}
              onChange={(color) => setFormData({ ...formData, [colorKey]: color })}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Colors</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ColorPickerButton label="Primary Color" colorKey="primaryColor" />
            <ColorPickerButton label="Secondary Color" colorKey="secondaryColor" />
            <ColorPickerButton label="Background Color" colorKey="backgroundColor" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Layout & Display</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Layout Style</label>
            <div className="flex gap-2">
              {['GRID', 'LIST', 'COMPACT'].map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => setFormData({ ...formData, layoutStyle: style as any })}
                  className={`px-4 py-2 rounded border ${
                    formData.layoutStyle === style
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                  }`}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          {formData.layoutStyle === 'GRID' && (
            <Input
              label="Items Per Row"
              type="number"
              min={1}
              max={4}
              value={formData.itemsPerRow}
              onChange={(e) => setFormData({ ...formData, itemsPerRow: parseInt(e.target.value) })}
            />
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.showRestaurantInfo}
                onChange={(e) => setFormData({ ...formData, showRestaurantInfo: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Show Restaurant Information</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.showPrices}
                onChange={(e) => setFormData({ ...formData, showPrices: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Show Prices</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.showDescription}
                onChange={(e) => setFormData({ ...formData, showDescription: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Show Product Descriptions</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.showImages}
                onChange={(e) => setFormData({ ...formData, showImages: e.target.checked })}
                className="rounded border-gray-300 text-blue-600"
              />
              <span className="text-sm text-gray-700">Show Product Images</span>
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Table QR Codes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={formData.enableTableQR}
              onChange={(e) => setFormData({ ...formData, enableTableQR: e.target.checked })}
              className="rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-700">Enable Table-Specific QR Codes</span>
          </label>

          {formData.enableTableQR && (
            <Input
              label="Table QR Message"
              type="text"
              value={formData.tableQRMessage}
              onChange={(e) => setFormData({ ...formData, tableQRMessage: e.target.value })}
              placeholder="Scan to view our menu"
            />
          )}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button
          type="submit"
          variant="primary"
          isLoading={isUpdating}
          className="flex items-center gap-2"
        >
          <Save className="h-4 w-4" />
          Save Changes
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleReset}
          className="flex items-center gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
      </div>
    </form>
  );
};

export default DesignEditor;
