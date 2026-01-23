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
      // Error handled by mutation
    }
  };

  const handleComplete = async (requestId: string) => {
    try {
      await completeRequest.mutateAsync(requestId);
    } catch (error) {
      // Error handled by mutation
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full ring-1 ring-inset ring-amber-200/60">
            {t('billRequests.pending')}
          </span>
        );
      case 'ACKNOWLEDGED':
        return (
          <span className="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-700 rounded-full ring-1 ring-inset ring-blue-200/60">
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
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-full md:w-[500px] bg-white shadow-2xl z-50 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-purple-500 to-pink-500 text-white px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-heading font-bold">{t('billRequests.title')}</h2>
              <p className="text-sm text-white/80">{billRequests.length} {billRequests.length !== 1 ? t('billRequests.activeRequests') : t('billRequests.activeRequest')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <Spinner size="lg" />
            </div>
          ) : billRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <Receipt className="h-8 w-8 text-slate-300" />
              </div>
              <p className="text-lg font-medium text-slate-500">{t('billRequests.noRequests')}</p>
              <p className="text-sm text-slate-400">{t('billRequests.allHandled')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {billRequests.map((request: BillRequest) => (
                <div
                  key={request.id}
                  className={`bg-white rounded-xl border shadow-sm overflow-hidden ${
                    request.status === 'PENDING' ? 'border-amber-200/60' : 'border-blue-200/60'
                  }`}
                >
                  {/* Request Header */}
                  <div className={`px-5 py-4 border-b ${
                    request.status === 'PENDING' ? 'bg-amber-50/80 border-amber-100' : 'bg-blue-50/80 border-blue-100'
                  }`}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {request.table ? (
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <MapPin className="h-4 w-4" />
                            <span>{t('tableLabel')} {request.table.number}</span>
                            {request.table.section && (
                              <span className="text-sm text-slate-500">({request.table.section})</span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 font-bold text-slate-900">
                            <Receipt className="h-4 w-4" />
                            <span>{t('billRequests.tablelessOrder')}</span>
                          </div>
                        )}
                      </div>
                      {getStatusBadge(request.status)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Clock className="h-3.5 w-3.5" />
                      <span>{new Date(request.createdAt).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* Request Content */}
                  <div className="p-5">
                    <p className="text-sm text-slate-600 mb-3">
                      {t('billRequests.customerRequested')}
                    </p>

                    {request.acknowledgedBy && (
                      <div className="text-xs text-slate-500">
                        {t('billRequests.acknowledgedBy')} {request.acknowledgedBy.firstName} {request.acknowledgedBy.lastName}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="bg-slate-50/80 px-5 py-4 border-t border-slate-100 flex gap-3">
                    {request.status === 'PENDING' ? (
                      <button
                        onClick={() => handleAcknowledge(request.id)}
                        disabled={acknowledgeRequest.isPending}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-purple-500 text-white rounded-xl hover:bg-purple-600 font-semibold transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {acknowledgeRequest.isPending ? (
                          <Spinner size="sm" color="white" />
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
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 font-semibold transition-all duration-200 shadow-sm hover:shadow disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {completeRequest.isPending ? (
                          <Spinner size="sm" color="white" />
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
