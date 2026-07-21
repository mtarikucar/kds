import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQrSettings, useUpdateQrSettings, useQrCodes } from '../../features/qr/qrApi';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import { QrCode, Download, Palette, Printer, LayoutGrid, Store, Search, X } from 'lucide-react';
import DesignEditor from '../../components/qr/DesignEditor';
import QrCodeDisplay from '../../components/qr/QrCodeDisplay';
import type { QrCodeData, UpdateQrSettingsDto } from '../../types';

// Escape operator-supplied free text before injecting it into the raw
// print-window HTML (the table-QR caption can contain `<`, `&`, quotes).
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const QRManagementPage = () => {
  const { t } = useTranslation('common');
  const [activeTab, setActiveTab] = useState<'codes' | 'design'>('codes');
  const [tableSearch, setTableSearch] = useState('');
  const { data: settingsData, isLoading: settingsLoading } = useQrSettings();
  const { data: qrCodesData, isLoading: codesLoading } = useQrCodes();
  const { mutate: updateSettings, isPending: isUpdating } = useUpdateQrSettings();

  const settings = settingsData;
  const qrCodes = useMemo(() => qrCodesData?.qrCodes || [], [qrCodesData]);
  const tenant = qrCodesData?.tenant;

  const tenantQRs = useMemo(() => qrCodes.filter((qr) => qr.type === 'TENANT'), [qrCodes]);
  const tableQRs = useMemo(() => qrCodes.filter((qr) => qr.type === 'TABLE'), [qrCodes]);

  // Batch print/download act on this filtered list: the DOM only holds the
  // visible cards, and printing exactly what you searched for is the point.
  const filterActive = tableSearch.trim().length > 0;
  const filteredTableQRs = useMemo(() => {
    const query = tableSearch.trim().toLocaleLowerCase();
    if (!query) return tableQRs;
    return tableQRs.filter((qr) => qr.label.toLocaleLowerCase().includes(query));
  }, [tableQRs, tableSearch]);

  const handleSettingsUpdate = (updates: UpdateQrSettingsDto) => {
    updateSettings(updates);
  };

  const printTableQRs = (targets: QrCodeData[]) => {
    const tenantName = qrCodesData?.tenant?.name;

    if (targets.length === 0) {
      alert(t('admin.noTableQRCodesToPrint'));
      return;
    }

    const printWindow = window.open('', '', 'width=800,height=600');
    if (!printWindow) {
      alert(t('admin.popupBlocked'));
      return;
    }

    const qrElements = targets.map((qr) => {
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

    // Prefer the operator's saved table-QR caption; fall back to the
    // translated default for empty/legacy settings. Escaped because it is
    // operator free text injected into raw print-window HTML.
    const tableQRCaption = escapeHtml(
      settings?.tableQRMessage?.trim() || t('admin.scanToViewMenu'),
    );

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
                <p class="instructions">${tableQRCaption}</p>
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

  const downloadTableQRs = (targets: QrCodeData[]) => {
    const tenantName = qrCodesData?.tenant?.name;

    if (targets.length === 0) {
      alert(t('admin.noTableQRCodesToPrint'));
      return;
    }

    // Snapshot every SVG synchronously at click time: the staggered timers
    // below outlive the current DOM (search edits / tab switches unmount
    // cards), and a late getElementById would silently drop those files.
    const snapshots = targets
      .map((qr) => {
        const svg = document.getElementById(`qr-${qr.id}-small`) ||
          document.getElementById(`qr-${qr.id}-medium`) ||
          document.getElementById(`qr-${qr.id}`);
        if (!svg) {
          console.warn(`QR element not found for ${qr.id}`);
          return null;
        }
        return { qr, svgData: new XMLSerializer().serializeToString(svg) };
      })
      .filter((item): item is { qr: QrCodeData; svgData: string } => item !== null);

    snapshots.forEach(({ qr, svgData }, index) => {
      setTimeout(() => {
        try {
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
      }, index * 500); // Stagger downloads to avoid browser blocking
    });
  };

  if (settingsLoading || codesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  const showTablePane = Boolean(settings?.enableTableQR);

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
        <div
          className={
            showTablePane
              ? 'grid gap-6 xl:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] xl:items-start'
              : ''
          }
          data-tour="qr-codes-list"
        >
          {/* Restaurant-wide QR — the hero code. No overflow-hidden here:
              it would clip the download dropdown that extends past the card. */}
          <section
            className={`bg-white rounded-2xl border border-slate-200/60 ${
              showTablePane ? 'xl:sticky xl:top-6' : 'max-w-xl mx-auto'
            }`}
            data-tour="qr-download"
          >
            <div className="px-5 md:px-6 pt-5 pb-4 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
                <Store className="h-5 w-5 text-primary-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">{t('admin.restaurantQRCode')}</h2>
                <p className="text-sm text-slate-500">{t('admin.restaurantQRDesc')}</p>
              </div>
            </div>
            <div className="p-5 md:p-6">
              {tenantQRs.map(qr => (
                <QrCodeDisplay
                  key={qr.id}
                  qrCode={qr}
                  tenant={tenant}
                  caption={settings?.tableQRMessage}
                  settings={{
                    primaryColor: settings?.primaryColor,
                    backgroundColor: settings?.backgroundColor
                  }}
                />
              ))}
            </div>
          </section>

          {/* Per-table QR codes */}
          {showTablePane && (
            <section className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
              <div className="px-5 md:px-6 pt-5 pb-4 border-b border-slate-100 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <LayoutGrid className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-900 flex items-center gap-2">
                      {t('admin.tableSpecificQRCodes')}
                      {tableQRs.length > 0 && (
                        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                          {tableQRs.length}
                        </span>
                      )}
                    </h2>
                    <p className="text-sm text-slate-500">{t('admin.tableSpecificQRDesc')}</p>
                  </div>
                </div>
                {tableQRs.length > 0 && (
                  <div className="flex flex-col sm:flex-row sm:items-center sm:flex-wrap gap-2">
                    <div className="relative flex-1 min-w-0 sm:max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        value={tableSearch}
                        onChange={(e) => setTableSearch(e.target.value)}
                        placeholder={t('admin.searchTablesPlaceholder')}
                        className="w-full h-9 pl-9 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-400 transition-colors"
                      />
                      {tableSearch && (
                        <button
                          onClick={() => setTableSearch('')}
                          aria-label={t('admin.clearSearch')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-slate-400 hover:text-slate-600"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                      <Button
                        onClick={() => printTableQRs(filteredTableQRs)}
                        variant="primary"
                        size="sm"
                        className="flex items-center gap-1.5"
                      >
                        <Printer className="h-4 w-4" />
                        {t('admin.printTableQRSheet')}
                        {filterActive && ` (${filteredTableQRs.length})`}
                      </Button>
                      <Button
                        onClick={() => downloadTableQRs(filteredTableQRs)}
                        variant="outline"
                        size="sm"
                        className="flex items-center gap-1.5"
                      >
                        <Download className="h-4 w-4" />
                        {t('admin.downloadAllQR')}
                        {filterActive && ` (${filteredTableQRs.length})`}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
              <div className="p-5 md:p-6">
                {tableQRs.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                      <LayoutGrid className="w-8 h-8 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-slate-900">{t('admin.noTablesFound')}</h3>
                    <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
                      {t('admin.noTablesFoundDescription')}
                    </p>
                  </div>
                ) : filteredTableQRs.length === 0 ? (
                  <div className="py-10 text-center">
                    <p className="text-sm font-medium text-slate-600">{t('admin.noTablesMatchSearch')}</p>
                    <button
                      onClick={() => setTableSearch('')}
                      className="mt-2 text-sm font-medium text-primary-600 hover:text-primary-700"
                    >
                      {t('admin.clearSearch')}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,10rem),1fr))] gap-3 md:gap-4">
                    {filteredTableQRs.map(qr => (
                      <QrCodeDisplay
                        key={qr.id}
                        qrCode={qr}
                        tenant={tenant}
                        compact
                        caption={settings?.tableQRMessage}
                        settings={{
                          primaryColor: settings?.primaryColor,
                          backgroundColor: settings?.backgroundColor
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
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
