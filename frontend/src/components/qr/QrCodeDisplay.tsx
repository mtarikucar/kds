import QRCode from 'react-qr-code';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  Search,
  Share2,
  Printer,
  ChevronDown,
  Copy,
  Check,
} from 'lucide-react';
import type { QrCodeData } from '../../types';
import Button from '../ui/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';

interface QrCodeDisplayProps {
  qrCode: QrCodeData;
  tenant?: { id: string; name: string };
  compact?: boolean;
  settings?: {
    primaryColor?: string;
    backgroundColor?: string;
  };
  /**
   * Operator-configured table-QR caption (QrMenuSettings.tableQRMessage).
   * Rendered under the code both on-screen and on the printed sheet,
   * falling back to the translated default when empty/unset (legacy rows).
   */
  caption?: string;
}

type DownloadFormat = 'png' | 'svg' | 'pdf';

// Raster exports always render print-quality; the on-screen preview size
// no longer matters because the export source is a vector SVG.
const EXPORT_PX = 1200;

// The table caption is operator-supplied free text that gets injected
// into the raw print-window HTML; escape it so a promo string containing
// `<`, `&` or quotes can't break (or inject into) the printed document.
const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const QrCodeDisplay = ({ qrCode, tenant, compact = false, settings, caption }: QrCodeDisplayProps) => {
  const { t } = useTranslation('common');
  const [copied, setCopied] = useState(false);

  // Prefer the operator's saved caption; fall back to the translated
  // default for empty/legacy settings rows.
  const resolvedCaption = caption?.trim() || t('admin.scanToViewMenu');

  // Compact table cards render the `-small` element, the hero card the
  // `-medium` one. QRManagementPage's batch print/download paths look these
  // ids up in the DOM — keep the suffixes in sync with that lookup.
  const elementId = compact ? `qr-${qrCode.id}-small` : `qr-${qrCode.id}-medium`;

  const fileName = `${tenant?.name || 'restaurant'}-${qrCode.label}`.replace(/\s/g, '-');

  const downloadQR = (format: DownloadFormat) => {
    const svg = document.getElementById(elementId);
    if (!svg) {
      console.warn(`QR element not found: ${elementId}`);
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);

    if (format === 'svg') {
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

    canvas.width = EXPORT_PX;
    canvas.height = EXPORT_PX;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);

      if (format === 'png') {
        const pngFile = canvas.toDataURL('image/png');
        const downloadLink = document.createElement('a');
        downloadLink.download = `${fileName}.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      } else {
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

  const printQR = () => {
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
            /* The serialized SVG carries its on-screen pixel size; pin a
               predictable physical size instead (vector = stays crisp). */
            .qr-container svg {
              width: 70mm;
              height: 70mm;
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
            <p style="font-size: 14px;">${escapeHtml(resolvedCaption)}</p>
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

  // A single compact action button (icon + accessible label).
  const IconAction = ({
    onClick,
    label,
    children,
  }: {
    onClick: () => void;
    label: string;
    children: React.ReactNode;
  }) => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex-1 h-9 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-primary-50 hover:text-primary-600 hover:border-primary-200 transition-colors"
    >
      {children}
    </button>
  );

  if (compact) {
    return (
      <div className="group bg-white border border-slate-200/70 rounded-2xl shadow-sm hover:shadow-md hover:border-primary-200 transition-all p-4 flex flex-col items-center">
        <div className="relative bg-white p-3 rounded-xl border border-slate-100 ring-1 ring-slate-100 mb-3">
          <QRCode
            id={elementId}
            value={qrCode.url}
            size={120}
            level="H"
            fgColor={settings?.primaryColor || '#000000'}
            bgColor={settings?.backgroundColor || '#FFFFFF'}
          />
        </div>
        <p className="font-semibold text-sm text-slate-900 text-center mb-3">{qrCode.label}</p>
        <div className="flex gap-2 w-full">
          <IconAction onClick={() => downloadQR('png')} label={t('qr.downloadQrCode')}>
            <Download className="h-4 w-4" />
          </IconAction>
          <IconAction onClick={openPreview} label={t('qr.previewMenu')}>
            <Search className="h-4 w-4" />
          </IconAction>
          <IconAction onClick={printQR} label={t('qr.printQrCode')}>
            <Printer className="h-4 w-4" />
          </IconAction>
        </div>
      </div>
    );
  }

  // Hero card: one QR, its link, and the three things an operator actually
  // does with it — download (print quality), print, preview.
  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-4 rounded-2xl border border-slate-200 ring-1 ring-slate-100 shadow-sm">
        <QRCode
          id={elementId}
          value={qrCode.url}
          size={208}
          level="H"
          fgColor={settings?.primaryColor || '#000000'}
          bgColor={settings?.backgroundColor || '#FFFFFF'}
        />
      </div>

      <h3 className="mt-4 text-lg font-bold text-slate-900 text-center">{qrCode.label}</h3>
      <p className="text-sm text-slate-500 text-center">{resolvedCaption}</p>

      {/* Menu URL */}
      <div className="mt-4 w-full flex items-center gap-2 bg-slate-50 rounded-xl border border-slate-200 pl-3 pr-1.5 py-1.5">
        <p className="flex-1 min-w-0 truncate font-mono text-xs text-slate-600" title={qrCode.url}>
          {qrCode.url}
        </p>
        <button
          onClick={copyToClipboard}
          className="shrink-0 h-8 px-2.5 inline-flex items-center gap-1.5 rounded-lg text-xs font-medium text-primary-600 hover:bg-primary-50 transition-colors"
        >
          {copied ? (
            <><Check className="h-3.5 w-3.5" /> {t('qr.copied')}</>
          ) : (
            <><Copy className="h-3.5 w-3.5" /> {t('buttons.copy')}</>
          )}
        </button>
      </div>

      {/* Actions */}
      <div className="mt-3 w-full space-y-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="primary" className="w-full flex items-center justify-center gap-2">
              <Download className="h-4 w-4" />
              {t('app.download')}
              <ChevronDown className="h-4 w-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-full min-w-[12rem]">
            {(['png', 'svg', 'pdf'] as const).map((format) => (
              <DropdownMenuItem key={format} onClick={() => downloadQR(format)}>
                {t('qr.downloadAs', { format: format.toUpperCase() })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={printQR}
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
    </div>
  );
};

export default QrCodeDisplay;
