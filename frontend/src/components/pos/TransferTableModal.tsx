import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, AlertTriangle, Check } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { useTables } from '../../features/tables/tablesApi';
import { Table, TableStatus } from '../../types';
import { Card } from '../ui/Card';

interface TransferTableModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceTable: Table;
  orderCount: number;
  onConfirm: (targetTableId: string) => void;
  isLoading?: boolean;
}

const TransferTableModal = ({
  isOpen,
  onClose,
  sourceTable,
  orderCount,
  onConfirm,
  isLoading = false,
}: TransferTableModalProps) => {
  const { t } = useTranslation('pos');
  const { data: tables, isLoading: isLoadingTables } = useTables();
  const [selectedTarget, setSelectedTarget] = useState<Table | null>(null);
  const [step, setStep] = useState<'select' | 'confirm'>('select');

  // Filter out source table and reserved tables
  const availableTables = tables?.filter(
    (table) => table.id !== sourceTable.id && table.status !== TableStatus.RESERVED
  ) || [];

  const getTableVariant = (status: string) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return 'success';
      case TableStatus.OCCUPIED:
        return 'warning';
      default:
        return 'default';
    }
  };

  const handleSelectTable = (table: Table) => {
    setSelectedTarget(table);
    setStep('confirm');
  };

  const handleBack = () => {
    setStep('select');
    setSelectedTarget(null);
  };

  const handleConfirm = () => {
    if (selectedTarget) {
      onConfirm(selectedTarget.id);
    }
  };

  const handleClose = () => {
    setStep('select');
    setSelectedTarget(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('transfer.title')} size="lg">
      {step === 'select' ? (
        <div className="space-y-4">
          {/* Source Table Info */}
          <div className="bg-blue-50 p-4 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">{t('transfer.sourceTable')}</p>
                <p className="text-2xl font-bold text-blue-600">
                  {t('table')} {sourceTable.number}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-600">{t('transfer.activeOrders')}</p>
                <p className="text-xl font-semibold text-slate-900">{orderCount}</p>
              </div>
            </div>
          </div>

          {/* Instruction */}
          <p className="text-sm text-slate-600">{t('transfer.selectTarget')}</p>

          {/* Table Grid */}
          {isLoadingTables ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : availableTables.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              {t('transfer.noAvailableTables')}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-h-[400px] overflow-y-auto">
              {availableTables.map((table) => (
                <Card
                  key={table.id}
                  className={`p-4 cursor-pointer transition-all hover:shadow-lg hover:scale-105 ${
                    table.status === TableStatus.OCCUPIED
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-green-300 bg-green-50'
                  }`}
                  onClick={() => handleSelectTable(table)}
                >
                  <div className="text-center">
                    <div className="text-2xl font-bold mb-2 text-slate-900">
                      {table.number}
                    </div>
                    <Badge variant={getTableVariant(table.status)} className="text-xs">
                      {t(`tableGrid.status.${table.status}`)}
                    </Badge>
                    {table.status === TableStatus.OCCUPIED && (
                      <div className="mt-2 text-xs text-orange-600 font-medium">
                        {t('transfer.willMerge')}
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Cancel Button */}
          <div className="flex justify-end pt-4">
            <Button variant="outline" onClick={handleClose}>
              {t('common:app.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        /* Confirmation Step */
        <div className="space-y-6">
          {/* Transfer Visualization */}
          <div className="flex items-center justify-center gap-4 py-4">
            {/* Source */}
            <div className="text-center">
              <div className="w-20 h-20 rounded-lg bg-blue-100 flex items-center justify-center mb-2">
                <span className="text-2xl font-bold text-blue-600">{sourceTable.number}</span>
              </div>
              <p className="text-sm text-slate-600">{t('transfer.from')}</p>
            </div>

            {/* Arrow */}
            <ArrowRight className="h-8 w-8 text-slate-400" />

            {/* Target */}
            <div className="text-center">
              <div className={`w-20 h-20 rounded-lg flex items-center justify-center mb-2 ${
                selectedTarget?.status === TableStatus.OCCUPIED
                  ? 'bg-orange-100'
                  : 'bg-green-100'
              }`}>
                <span className={`text-2xl font-bold ${
                  selectedTarget?.status === TableStatus.OCCUPIED
                    ? 'text-orange-600'
                    : 'text-green-600'
                }`}>
                  {selectedTarget?.number}
                </span>
              </div>
              <p className="text-sm text-slate-600">{t('transfer.to')}</p>
            </div>
          </div>

          {/* Transfer Details */}
          <div className="bg-slate-50 p-4 rounded-lg space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">{t('transfer.ordersToTransfer')}</span>
              <span className="font-semibold">{orderCount}</span>
            </div>
          </div>

          {/* Warning for occupied table */}
          {selectedTarget?.status === TableStatus.OCCUPIED && (
            <div className="flex items-start gap-3 bg-orange-50 border border-orange-200 rounded-lg p-4">
              <AlertTriangle className="h-5 w-5 text-orange-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-orange-800">{t('transfer.mergeWarningTitle')}</p>
                <p className="text-sm text-orange-700">{t('transfer.mergeWarningDescription')}</p>
              </div>
            </div>
          )}

          {/* Confirmation Text */}
          <p className="text-center text-slate-600">
            {t('transfer.confirmText', {
              count: orderCount,
              sourceTable: sourceTable.number,
              targetTable: selectedTarget?.number,
            })}
          </p>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleBack}>
              {t('common:app.back')}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleConfirm}
              isLoading={isLoading}
            >
              <Check className="h-4 w-4 mr-2" />
              {t('transfer.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default TransferTableModal;
