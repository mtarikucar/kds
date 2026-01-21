import QRCode from 'react-qr-code';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Search, Share2, Printer, FileImage, FileText, Copy, Check } from 'lucide-react';
import type { QrCodeData } from '../../types';
import Button from '../ui/Button';

interface QrCodeDisplayProps {
  qrCode: QrCodeData;
  tenant?: { id: string; name: string };
  compact?: boolean;
  settings?: {
    primaryColor?: string;
    backgroundColor?: string;
  };
}

const QrCodeDisplay = ({ qrCode, tenant, compact = false, settings }: QrCodeDisplayProps) => {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);
  const [selectedSize, setSelectedSize] = useState<'small' | 'medium' | 'large'>('medium');
  const [downloadFormat, setDownloadFormat] = useState<'png' | 'svg' | 'pdf'>('png');

  const sizePresets = {
    small: { size: 150, label: t('admin.tableTent'), description: '150x150px' },
    medium: { size: 300, label: t('admin.standard'), description: '300x300px' },
    large: { size: 600, label: t('admin.poster'), description: '600x600px' }
  };

  const currentSize = sizePresets[selectedSize];

  const downloadQR = (forceSize?: 'small' | 'medium' | 'large') => {
    const sizeToUse = forceSize || selectedSize;
    const sizeConfig = sizePresets[sizeToUse];
    const elementId = `qr-${qrCode.id}-${sizeToUse}`;
    const svg = document.getElementById(elementId);

    if (!svg) {
      console.warn(`QR element not found: ${elementId}`);
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const fileName = `${tenant?.name || 'restaurant'}-${qrCode.label.replace(/\s/g, '-')}-${sizeToUse}`;

    if (downloadFormat === 'svg') {
      const blob = new Blob([svgData], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.download = `${fileName}.svg`;
      downloadLink.href = url;
      downloadLink.click();
      URL.revokeObjectURL(url);
      return;
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    // Use the size based on forceSize, not selectedSize
    canvas.width = sizeConfig.size * 2;
    canvas.height = sizeConfig.size * 2;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (downloadFormat === 'png') {
        const pngFile = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${fileName}.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      } else if (downloadFormat === 'pdf') {
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank');
            URL.revokeObjectURL(url);
          }
        });
      }
    };

    img.onerror = (e) => {
      console.error('Failed to load SVG as image:', e);
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(qrCode.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareQR = () => {
    if (navigator.share) {
      navigator.share({
        title: `${tenant?.name} - ${qrCode.label}`,
        text: t('qr.shareText'),
        url: qrCode.url
      });
    }
  };

  const printQR = (forceSize?: 'small' | 'medium' | 'large') => {
    const sizeToUse = forceSize || selectedSize;
    const elementId = `qr-${qrCode.id}-${sizeToUse}`;
    const printWindow = window.open('', '', 'width=600,height=600');
    if (!printWindow) {
      console.warn('Could not open print window');
      return;
    }

    const svg = document.getElementById(elementId);
    if (!svg) {
      console.warn(`QR element not found for print: ${elementId}`);
      printWindow.close();
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${tenant?.name} - ${qrCode.label}</title>
          <style>
            body { 
              display: flex; 
              justify-content: center; 
              align-items: center; 
              min-height: 100vh; 
              margin: 0;
              text-align: center;
            }
            .qr-container {
              padding: 20px;
            }
            h1 { margin-bottom: 10px; }
            p { margin-top: 10px; color: #666; }
          </style>
        </head>
        <body>
          <div class="qr-container">
            <h1>${tenant?.name}</h1>
            ${svgData}
            <p>${qrCode.label}</p>
            <p style="font-size: 14px;">${t('admin.scanToViewMenu')}</p>
          </div>
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  };

  const openPreview = () => {
    window.open(qrCode.url, '_blank');
  };

  if (compact) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col items-center">
        <div className="bg-gradient-to-br from-gray-50 to-white p-3 rounded-lg border border-slate-100 mb-3">
          <QRCode
            id={`qr-${qrCode.id}-small`}
            value={qrCode.url}
            size={120}
            level="H"
            fgColor={settings?.primaryColor || '#000000'}
            bgColor={settings?.backgroundColor || '#FFFFFF'}
          />
        </div>
        <p className="font-semibold text-sm text-slate-900 mb-1">{qrCode.label}</p>
        <p className="text-xs text-slate-500 mb-3">{t('admin.clickToViewOptions')}</p>
        <div className="flex gap-2 w-full">
          <button
            onClick={() => downloadQR('small')}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 bg-white hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1 transition-colors"
            title={t('qr.downloadQrCode')}
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={openPreview}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 bg-white hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1 transition-colors"
            title={t('qr.previewMenu')}
          >
            <Search className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => printQR('small')}
            className="flex-1 px-3 py-2 text-sm border border-slate-200 bg-white hover:bg-slate-50 rounded-lg flex items-center justify-center gap-1 transition-colors"
            title={t('qr.printQrCode')}
          >
            <Printer className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-6">
      <div className="grid md:grid-cols-2 gap-8">
        {/* QR Code Display Section */}
        <div className="space-y-4">
          <div className="text-center">
            <h3 className="text-xl font-bold text-slate-900 mb-2">{qrCode.label}</h3>
            <p className="text-sm text-slate-600">{t('admin.scanToViewMenu')}</p>
          </div>

          {/* Size Selector */}
          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-medium text-slate-700 mb-2 uppercase tracking-wide">{t('qr.previewSize')}</p>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(sizePresets).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => setSelectedSize(key as any)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${selectedSize === key
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white text-slate-700 border border-slate-200 hover:border-blue-300'
                    }`}
                >
                  <div className="text-xs">{preset.label}</div>
                  <div className="text-xs opacity-75">{preset.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* QR Code Preview */}
          <div className="flex justify-center">
            <div className="bg-gradient-to-br from-gray-50 to-white p-4 rounded-xl border-2 border-slate-200 shadow-inner">
              <QRCode
                id={`qr-${qrCode.id}-${selectedSize}`}
                value={qrCode.url}
                size={currentSize.size}
                level="H"
                fgColor={settings?.primaryColor || '#000000'}
                bgColor={settings?.backgroundColor || '#FFFFFF'}
              />
            </div>
          </div>
        </div>

        {/* Actions Section */}
        <div className="space-y-4">
          {/* URL Display */}
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-700 uppercase tracking-wide">{t('qr.menuUrl')}</p>
              <button
                onClick={copyToClipboard}
                className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                {copied ? (
                  <><Check className="h-3 w-3" /> {t('qr.copied')}</>
                ) : (
                  <><Copy className="h-3 w-3" /> {t('buttons.copy')}</>)}
              </button>
            </div>
            <p className="text-sm text-slate-900 font-mono break-all bg-white rounded p-2 border border-slate-200">
              {qrCode.url}
            </p>
          </div>

          {/* Download Options */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-slate-700 uppercase tracking-wide">{t('qr.downloadFormat')}</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => setDownloadFormat('png')}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${downloadFormat === 'png'
                  ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
                  }`}
              >
                <FileImage className="h-4 w-4" />
                {t('qr.png')}
              </button>
              <button
                onClick={() => setDownloadFormat('svg')}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${downloadFormat === 'svg'
                  ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
                  }`}
              >
                <FileImage className="h-4 w-4" />
                {t('qr.svg')}
              </button>
              <button
                onClick={() => setDownloadFormat('pdf')}
                className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${downloadFormat === 'pdf'
                  ? 'bg-blue-100 text-blue-700 border-2 border-blue-300'
                  : 'bg-white text-slate-700 border border-slate-200 hover:border-slate-300'
                  }`}
              >
                <FileText className="h-4 w-4" />
                {t('qr.pdf')}
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-4">
            <Button
              onClick={() => downloadQR()}
              variant="primary"
              className="w-full flex items-center justify-center gap-2"
            >
              <Download className="h-5 w-5" />
              {t('qr.downloadFile', { format: downloadFormat.toUpperCase(), size: currentSize.label })}
            </Button>

            <div className="grid grid-cols-2 gap-3">
              <Button
                onClick={() => printQR()}
                variant="outline"
                className="flex items-center justify-center gap-2"
              >
                <Printer className="h-4 w-4" />
                {t('buttons.print')}
              </Button>
              <Button
                onClick={openPreview}
                variant="outline"
                className="flex items-center justify-center gap-2"
              >
                <Search className="h-4 w-4" />
                {t('buttons.preview')}
              </Button>
            </div>

            {typeof (navigator as any).share === 'function' && (
              <Button
                onClick={shareQR}
                variant="outline"
                className="w-full flex items-center justify-center gap-2"
              >
                <Share2 className="h-4 w-4" />
                {t('qr.shareQrCode')}
              </Button>
            )}
          </div>

          {/* Usage Tips */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
            <p className="text-xs font-medium text-blue-900 mb-1">{t('qr.proTipsTitle')}</p>
            <ul className="text-xs text-blue-800 space-y-1">
              <li>• {t('qr.proTip1')}</li>
              <li>• {t('qr.proTip2')}</li>
              <li>• {t('qr.proTip3')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default QrCodeDisplay;
