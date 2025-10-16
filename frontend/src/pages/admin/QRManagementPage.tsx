import { useState } from 'react';
import { useQrSettings, useUpdateQrSettings, useQrCodes } from '../../features/qr/qrApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { QrCode, Download, Palette, Eye } from 'lucide-react';
import DesignEditor from '../../components/qr/DesignEditor';
import QrCodeDisplay from '../../components/qr/QrCodeDisplay';
import type { UpdateQrSettingsDto } from '../../types';

const QRManagementPage = () => {
  const [activeTab, setActiveTab] = useState<'codes' | 'design'>('codes');
  const { data: settingsData, isLoading: settingsLoading } = useQrSettings();
  const { data: qrCodesData, isLoading: codesLoading } = useQrCodes();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdateQrSettings();

  const handleSettingsUpdate = (updates: UpdateQrSettingsDto) => {
    updateSettings(updates);
  };

  if (settingsLoading || codesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const settings = settingsData;
  const qrCodes = qrCodesData?.qrCodes || [];
  const tenant = qrCodesData?.tenant;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">QR Code Management</h1>
        <p className="text-gray-600">Generate and customize QR codes for your restaurant</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('codes')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
              ${activeTab === 'codes'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <QrCode className="h-5 w-5" />
            QR Codes
          </button>
          <button
            onClick={() => setActiveTab('design')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
              ${activeTab === 'design'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }
            `}
          >
            <Palette className="h-5 w-5" />
            Design & Settings
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'codes' && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Restaurant QR Code</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                This QR code displays your full menu. Perfect for table tents, window signs, or marketing materials.
              </p>
              {qrCodes.filter(qr => qr.type === 'TENANT').map(qr => (
                <QrCodeDisplay key={qr.id} qrCode={qr} tenant={tenant} />
              ))}
            </CardContent>
          </Card>

          {settings?.enableTableQR && (
            <Card>
              <CardHeader>
                <CardTitle>Table-Specific QR Codes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  Each table has its own QR code. Customers scanning these will see which table they're at.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {qrCodes.filter(qr => qr.type === 'TABLE').map(qr => (
                    <QrCodeDisplay key={qr.id} qrCode={qr} tenant={tenant} compact />
                  ))}
                </div>
                {qrCodes.filter(qr => qr.type === 'TABLE').length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>No tables found. Please add tables first.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'design' && settings && (
        <DesignEditor
          settings={settings}
          onUpdate={handleSettingsUpdate}
          isUpdating={isUpdating}
        />
      )}
    </div>
  );
};

export default QRManagementPage;
