import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQrSettings, useUpdateQrSettings, useQrCodes } from '../../features/qr/qrApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { QrCode, Download, Palette, Eye, DownloadCloud, FileArchive } from 'lucide-react';
import DesignEditor from '../../components/qr/DesignEditor';
import QrCodeDisplay from '../../components/qr/QrCodeDisplay';
import type { UpdateQrSettingsDto } from '../../types';

const QRManagementPage = () => {
  const { t } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<'codes' | 'design'>('codes');
  const { data: settingsData, isLoading: settingsLoading } = useQrSettings();
  const { data: qrCodesData, isLoading: codesLoading } = useQrCodes();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdateQrSettings();

  const handleSettingsUpdate = (updates: UpdateQrSettingsDto) => {
    updateSettings(updates);
  };

  const downloadAllQRs = () => {
    const allQRs = qrCodes;
    
    allQRs.forEach((qr, index) => {
      setTimeout(() => {
        // Try multiple possible QR element IDs
        const svg = document.getElementById(`qr-${qr.id}-small`) || 
                  document.getElementById(`qr-${qr.id}-medium`) || 
                  document.getElementById(`qr-${qr.id}`);
        
        if (!svg) {
          console.warn(`QR element not found for ${qr.id}`);
          return;
        }

        try {
          const svgData = new XMLSerializer().serializeToString(svg);
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          if (!ctx) {
            console.error('Canvas context not available');
            return;
          }
          
          const img = new Image();
          canvas.width = 600;
          canvas.height = 600;

          img.onload = () => {
            try {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const pngFile = canvas.toDataURL('image/png');
              const downloadLink = document.createElement('a');
              downloadLink.download = `${tenant?.name || 'restaurant'}-${qr.label.replace(/\\s/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}.png`;
              downloadLink.href = pngFile;
              downloadLink.click();
            } catch (error) {
              console.error('Error generating download for QR code:', error);
            }
          };

          img.onerror = () => {
            console.error('Error loading SVG for QR code');
          };

          img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
        } catch (error) {
          console.error('Error processing QR code:', error);
        }
      }, index * 500); // Stagger downloads
    });
  };

  const printAllTableQRs = () => {
    const tableQRs = qrCodes.filter(qr => qr.type === 'TABLE');
    
    if (tableQRs.length === 0) {
      alert(t('admin.noTableQRCodesToPrint'));
      return;
    }

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
      alert(t('admin.popupBlocked'));
      return;
    }

    const qrElements = tableQRs.map((qr) => {
      const svg = document.getElementById(`qr-${qr.id}-small`) || 
                  document.getElementById(`qr-${qr.id}-medium`) || 
                  document.getElementById(`qr-${qr.id}`);
      return {
        qr,
        svgElement: svg ? new XMLSerializer().serializeToString(svg) : null
      };
    });

    const validQRs = qrElements.filter(item => item.svgElement);

    if (validQRs.length === 0) {
      alert(t('admin.noQRCodesForPrinting'));
      printWindow.close();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${tenant?.name || 'Restaurant'} - Table QR Codes</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 20px; 
              margin: 0;
            }
            .qr-grid { 
              display: grid; 
              grid-template-columns: repeat(3, 1fr); 
              gap: 20px; 
              page-break-inside: avoid; 
            }
            .qr-item { 
              text-align: center; 
              border: 2px solid #ddd; 
              padding: 15px; 
              border-radius: 12px;
              background: white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            h1 { 
              text-align: center; 
              margin-bottom: 30px; 
              color: #333;
              font-size: 24px;
            }
            h3 { 
              margin: 10px 0 15px 0; 
              color: #555;
              font-size: 16px;
            }
            .instructions {
              font-size: 14px; 
              color: #666; 
              margin-top: 15px;
              font-style: italic;
            }
            svg {
              max-width: 100%;
              height: auto;
            }
            @media print { 
              .qr-grid { grid-template-columns: repeat(2, 1fr); }
              body { padding: 10px; }
              .qr-item { break-inside: avoid; }
            }
          </style>
        </head>
        <body>
          <h1>${tenant?.name || 'Restaurant'} - ${t('admin.tableQRCodes')}</h1>
          <div class="qr-grid">
            ${validQRs.map(({ qr, svgElement }) => `
              <div class="qr-item">
                <h3>${qr.label}</h3>
                ${svgElement}
                <p class="instructions">${t('admin.scanToViewMenu')}</p>
              </div>
            `).join('')}
          </div>
          <div style="margin-top: 30px; text-align: center; color: #999; font-size: 12px;">
            ${t('admin.generatedOn')} ${new Date().toLocaleDateString()} - ${validQRs.length} QR codes
          </div>
        </body>
      </html>
    `);
    
    printWindow.document.close();
    printWindow.focus();
    
    // Wait for content to load before printing
    setTimeout(() => {
      printWindow.print();
      setTimeout(() => printWindow.close(), 1000);
    }, 750);
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
        <h1 className="text-3xl font-bold text-gray-900">{t('admin.qrCodeManagement')}</h1>
        <p className="text-gray-600">{t('admin.generateCustomizeQR')}</p>
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
            {t('admin.qrCodes')}
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
            {t('admin.designSettings')}
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'codes' && (
        <div className="space-y-6">
          {/* Batch Operations */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileArchive className="h-5 w-5" />
                {t('admin.batchOperations')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                {t('admin.batchOperationsDesc')}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={downloadAllQRs}
                  variant="outline"
                  className="flex items-center gap-2"
                >
                  <DownloadCloud className="h-4 w-4" />
                  {t('admin.downloadAllQR')}
                </Button>
                {settings?.enableTableQR && qrCodes.filter(qr => qr.type === 'TABLE').length > 0 && (
                  <Button
                    onClick={printAllTableQRs}
                    variant="outline"
                    className="flex items-center gap-2"
                  >
                    <Eye className="h-4 w-4" />
                    {t('admin.printTableQRSheet')}
                  </Button>
                )}
              </div>
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs font-medium text-blue-900 mb-1">{t('admin.batchTips')}:</p>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li>• {t('admin.batchTip1')}</li>
                  <li>• {t('admin.batchTip2')}</li>
                  <li>• {t('admin.batchTip3')}</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('admin.restaurantQRCode')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-600 mb-4">
                {t('admin.restaurantQRDesc')}
              </p>
              {qrCodes.filter(qr => qr.type === 'TENANT').map(qr => (
                <QrCodeDisplay 
                  key={qr.id} 
                  qrCode={qr} 
                  tenant={tenant} 
                  settings={{
                    primaryColor: settings?.primaryColor,
                    backgroundColor: settings?.backgroundColor
                  }}
                />
              ))}
            </CardContent>
          </Card>

          {settings?.enableTableQR && (
            <Card>
              <CardHeader>
                <CardTitle>{t('admin.tableSpecificQRCodes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-600 mb-4">
                  {t('admin.tableSpecificQRDesc')}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {qrCodes.filter(qr => qr.type === 'TABLE').map(qr => (
                    <QrCodeDisplay 
                      key={qr.id} 
                      qrCode={qr} 
                      tenant={tenant} 
                      compact
                      settings={{
                        primaryColor: settings?.primaryColor,
                        backgroundColor: settings?.backgroundColor
                      }}
                    />
                  ))}
                </div>
                {qrCodes.filter(qr => qr.type === 'TABLE').length === 0 && (
                  <div className="text-center py-8 text-gray-500">
                    <p>{t('admin.noTablesFound')}</p>
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
          tenant={tenant}
        />
      )}
    </div>
  );
};

export default QRManagementPage;
