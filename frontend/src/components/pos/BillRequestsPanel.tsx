import { X, Check, Receipt, MapPin, Clock } from 'lucide-react';
import { useBillRequests, useAcknowledgeBillRequest, useCompleteBillRequest } from '../../features/orders/ordersApi';
import { BillRequest } from '../../types';
import Spinner from '../ui/Spinner';
import { useTranslation } from 'react-i18next';

interface BillRequestsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const BillRequestsPanel = ({ isOpen, onClose }: BillRequestsPanelProps) => {
  const { t } = useTranslation('pos');
  const { data: billRequests = [], isLoading } = useBillRequests();
  const acknowledgeRequest = useAcknowledgeBillRequest();
  const completeRequest = useCompleteBillRequest();

  const handleAcknowledge = async (requestId: string) => {
    try {
      await acknowledgeRequest.mutateAsync(requestId);
    } catch (error) {
      console.error('Error acknowledging request:', error);
    }
  };

  const handleComplete = async (requestId: string) => {
    try {
      await completeRequest.mutateAsync(requestId);
    } catch (error) {
      console.error('Error completing request:', error);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 rounded">
            {t('billRequests.pending')}
          </span>
        );
      case 'ACKNOWLEDGED':
        return (
          <span className="px-2 py-1 text-xs font-semibold bg-blue-100 text-blue-800 rounded">
            {t('billRequests.inProgress')}
          </span>
        );
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[500px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Receipt className="h-6 w-6" />
            <div>
              <h2 className="text-xl font-bold">{t('billRequests.title')}</h2>
              <p className="text-sm opacity-90">{billRequests.length} {billRequests.length !== 1 ? t('billRequests.activeRequests') : t('billRequests.activeRequest')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : billRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Receipt className="h-16 w-16 mb-4" />
              <p className="text-lg font-medium">{t('billRequests.noRequests')}</p>
              <p className="text-sm">{t('billRequests.allHandled')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {billRequests.map((request: BillRequest) => (
                <div
                  key={request.id}
                  className={`bg-white border-2 rounded-xl shadow-md overflow-hidden ${
                    request.status === 'PENDING' ? 'border-yellow-200' : 'border-blue-200'
                  }`}
                >
                  {/* Request Header */}
                  <div className={`px-4 py-3 border-b ${
                    request.status === 'PENDING' ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {request.table && (
                          <div className="flex items-center gap-1 font-bold text-gray-900">
                            <MapPin className="h-4 w-4" />
                            <span>Table {request.table.number}</span>
                            {request.table.section && (
                              <span className="text-sm text-gray-500">({request.table.section})</span>
                            )}
                          </div>
                        )}
                      </div>
                      {getStatusBadge(request.status)}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <Clock className="h-3 w-3" />
                      <span>{new Date(request.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Request Content */}
                  <div className="p-4">
                    <p className="text-sm text-gray-600 mb-3">
                      {t('billRequests.customerRequested')}
                    </p>

                    {request.acknowledgedBy && (
                      <div className="text-xs text-gray-500">
                        {t('billRequests.acknowledgedBy')} {request.acknowledgedBy.firstName} {request.acknowledgedBy.lastName}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="bg-gray-50 px-4 py-3 border-t flex gap-2">
                    {request.status === 'PENDING' ? (
                      <button
                        onClick={() => handleAcknowledge(request.id)}
                        disabled={acknowledgeRequest.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {acknowledgeRequest.isPending ? (
                          <Spinner size="sm" />
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            {t('billRequests.acknowledge')}
                          </>
                        )}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleComplete(request.id)}
                        disabled={completeRequest.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {completeRequest.isPending ? (
                          <Spinner size="sm" />
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            {t('billRequests.complete')}
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default BillRequestsPanel;
