import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQrSettings, useUpdateQrSettings, useQrCodes } from '../../features/qr/qrApi';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { QrCode, Download, Palette, Eye, DownloadCloud, FileArchive, LayoutGrid, Store } from 'lucide-react';
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
    const allQRs = qrCodesData?.qrCodes || [];

    if (allQRs.length === 0) {
      alert(t('admin.noQRCodesToDownload'));
      return;
    }

    allQRs.forEach((qr, index) => {
      setTimeout(() => {
        // Compact mode renders with '-small' suffix
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
              downloadLink.download = `${qrCodesData?.tenant?.name || 'restaurant'}-${qr.label.replace(/\\s/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}.png`;
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
    const tableQRs = (qrCodesData?.qrCodes || []).filter(qr => qr.type === 'TABLE');
    const tenantName = qrCodesData?.tenant?.name;

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
          <title>${tenantName || 'Restaurant'} - Table QR Codes</title>
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
          <h1>${tenantName || 'Restaurant'} - ${t('admin.tableQRCodes')}</h1>
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

  // Download only table QR codes
  const downloadTableQRs = () => {
    const tableQRs = (qrCodesData?.qrCodes || []).filter(qr => qr.type === 'TABLE');
    const tenantName = qrCodesData?.tenant?.name;

    if (tableQRs.length === 0) {
      alert(t('admin.noTableQRCodesToPrint'));
      return;
    }

    tableQRs.forEach((qr, index) => {
      setTimeout(() => {
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

          if (!ctx) return;

          const img = new Image();
          canvas.width = 600;
          canvas.height = 600;

          img.onload = () => {
            try {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              const pngFile = canvas.toDataURL('image/png');
              const downloadLink = document.createElement('a');
              downloadLink.download = `${tenantName || 'restaurant'}-${qr.label.replace(/\\s/g, '-').replace(/[^a-zA-Z0-9-]/g, '')}.png`;
              downloadLink.href = pngFile;
              downloadLink.click();
            } catch (error) {
              console.error('Error generating download:', error);
            }
          };

          img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
        } catch (error) {
          console.error('Error processing QR code:', error);
        }
      }, index * 500);
    });
  };

  const settings = settingsData;
  const qrCodes = qrCodesData?.qrCodes || [];
  const tenant = qrCodesData?.tenant;

  // Calculate statistics - must be before any early returns (Rules of Hooks)
  const stats = useMemo(() => {
    const tableQRs = qrCodes.filter(qr => qr.type === 'TABLE').length;
    const tenantQRs = qrCodes.filter(qr => qr.type === 'TENANT').length;
    return {
      total: qrCodes.length,
      tableQRs,
      tenantQRs,
    };
  }, [qrCodes]);

  if (settingsLoading || codesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6" data-tour="qr-management">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
          <QrCode className="w-7 h-7 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold text-slate-900">{t('admin.qrCodeManagement')}</h1>
          <p className="text-slate-500 mt-0.5">{t('admin.generateCustomizeQR')}</p>
        </div>
      </div>

      {/* Statistics Overview */}
      {qrCodes.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Total QR Codes */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <QrCode className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-500">{t('admin.totalQRCodes')}</p>
            </div>
          </div>

          {/* Table QR Codes */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <LayoutGrid className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{stats.tableQRs}</p>
              <p className="text-sm text-slate-500">{t('admin.tableQRCodes')}</p>
            </div>
          </div>

          {/* Restaurant QR Code */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
              <Store className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-primary-600">{stats.tenantQRs}</p>
              <p className="text-sm text-slate-500">{t('admin.restaurantQRCode')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-slate-200/60">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('codes')}
            className={`
              py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2
              ${activeTab === 'codes'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
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
        <div className="space-y-6" data-tour="qr-codes-list">
          {/* Batch Operations */}
          <Card data-tour="qr-download">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileArchive className="h-5 w-5" />
                {t('admin.batchOperations')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500 mb-4">
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
              <div className="mt-4 px-6 py-5 bg-primary-50 border border-primary-200 rounded-xl">
                <p className="text-xs font-medium text-primary-900 mb-1">{t('admin.batchTips')}:</p>
                <ul className="text-xs text-primary-800 space-y-1">
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
              <p className="text-sm text-slate-500 mb-4">
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
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{t('admin.tableSpecificQRCodes')}</CardTitle>
                {qrCodes.filter(qr => qr.type === 'TABLE').length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      onClick={downloadTableQRs}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <Download className="h-4 w-4" />
                      {t('admin.downloadAllQR')}
                    </Button>
                    <Button
                      onClick={printAllTableQRs}
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                    >
                      <Eye className="h-4 w-4" />
                      {t('admin.printTableQRSheet')}
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500 mb-4">
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
                  <div className="col-span-full py-12 text-center">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                      <LayoutGrid className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900">{t('admin.noTablesFound')}</h3>
                    <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
                      {t('admin.noTablesFoundDescription')}
                    </p>
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
