import { useNavigate, useSearchParams } from 'react-router-dom';
import { XCircle, RefreshCw, ArrowLeft, HelpCircle } from 'lucide-react';

export default function PaymentFailedPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const merchantOid = searchParams.get('oid');
  const type = searchParams.get('type');

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        {/* Error Icon */}
        <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <XCircle className="w-12 h-12 text-red-500" />
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Odeme Basarisiz
        </h2>

        {/* Description */}
        <p className="text-gray-600 mb-6">
          Odeme islemi tamamlanamadi. Bu asagidaki nedenlerden kaynaklanmis olabilir:
        </p>

        {/* Possible Reasons */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6 text-left">
          <ul className="text-sm text-gray-600 space-y-2">
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>Kart bilgileri hatali girilmis olabilir</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>Kartinizda yeterli bakiye olmayabilir</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>Bankaniz islemi reddetmis olabilir</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5">-</span>
              <span>3D Secure dogrulama basarisiz olabilir</span>
            </li>
          </ul>
        </div>

        {/* Order Reference */}
        {merchantOid && (
          <div className="bg-gray-50 rounded-lg p-4 mb-6">
            <p className="text-sm text-gray-500 mb-1">Siparis Referansi</p>
            <p className="text-sm font-mono text-gray-700">{merchantOid}</p>
          </div>
        )}

        {/* CTA Buttons */}
        <div className="space-y-3">
          <button
            onClick={() => navigate('/subscription/plans')}
            className="w-full px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-5 h-5" />
            Tekrar Dene
          </button>

          <button
            onClick={() => navigate('/subscription')}
            className="w-full px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
          >
            <ArrowLeft className="w-5 h-5" />
            Abonelige Don
          </button>
        </div>

        {/* Help Link */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <a
            href="/contact"
            className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700"
          >
            <HelpCircle className="w-4 h-4" />
            Sorun devam ederse destek ile iletisime gecin
          </a>
        </div>
      </div>
    </div>
  );
}
