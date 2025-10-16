import { QRCodeSVG } from 'react-qr-code';
import Button from '../ui/Button';
import { Download, ExternalLink } from 'lucide-react';
import type { QrCodeData } from '../../types';

interface QrCodeDisplayProps {
  qrCode: QrCodeData;
  tenant?: { id: string; name: string };
  compact?: boolean;
}

const QrCodeDisplay = ({ qrCode, tenant, compact = false }: QrCodeDisplayProps) => {
  const downloadQR = () => {
    const svg = document.getElementById(`qr-${qrCode.id}`);
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = 1000;
    canvas.height = 1000;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0);
      const pngFile = canvas.toDataURL('image/png');
      const downloadLink = document.createElement('a');
      downloadLink.download = `${tenant?.name || 'restaurant'}-${qrCode.label.replace(/\s/g, '-')}.png`;
      downloadLink.href = pngFile;
      downloadLink.click();
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  };

  const openPreview = () => {
    window.open(qrCode.url, '_blank');
  };

  if (compact) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col items-center">
        <div className="bg-white p-2 rounded border border-gray-200 mb-2">
          <QRCodeSVG
            id={`qr-${qrCode.id}`}
            value={qrCode.url}
            size={120}
            level="H"
          />
        </div>
        <p className="font-medium text-sm text-gray-900 mb-2">{qrCode.label}</p>
        <div className="flex gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={downloadQR}
            className="flex-1"
          >
            <Download className="h-3 w-3" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openPreview}
            className="flex-1"
          >
            <ExternalLink className="h-3 w-3" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row gap-6 items-center">
      <div className="bg-white p-4 rounded-lg border-2 border-gray-200 shadow-sm">
        <QRCodeSVG
          id={`qr-${qrCode.id}`}
          value={qrCode.url}
          size={256}
          level="H"
        />
      </div>

      <div className="flex-1 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">{qrCode.label}</h3>
          <p className="text-sm text-gray-600">
            Scan this code to view the menu
          </p>
        </div>

        <div className="bg-gray-50 p-3 rounded border border-gray-200">
          <p className="text-xs text-gray-500 mb-1">URL:</p>
          <p className="text-sm text-gray-900 font-mono break-all">{qrCode.url}</p>
        </div>

        <div className="flex gap-3">
          <Button
            variant="primary"
            onClick={downloadQR}
            className="flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Download PNG
          </Button>
          <Button
            variant="outline"
            onClick={openPreview}
            className="flex items-center gap-2"
          >
            <ExternalLink className="h-4 w-4" />
            Preview Menu
          </Button>
        </div>
      </div>
    </div>
  );
};

export default QrCodeDisplay;
