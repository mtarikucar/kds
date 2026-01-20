import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, AlertCircle, CheckCircle2, Clock, Table as TableIcon } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { Card } from '../ui/Card';
import { useTables } from '../../features/tables/tablesApi';
import { Table, TableStatus } from '../../types';
import { cn } from '../../lib/utils';

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

  // Filter out source table and reserved tables
  const availableTables = tables?.filter(
    (table) => table.id !== sourceTable.id && table.status !== TableStatus.RESERVED
  ) || [];

  const handleConfirm = () => {
    if (selectedTarget) {
      onConfirm(selectedTarget.id);
    }
  };

  const handleClose = () => {
    setSelectedTarget(null);
    onClose();
  };

  const getTableVariant = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return 'success';
      case TableStatus.OCCUPIED:
        return 'danger';
      case TableStatus.RESERVED:
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusColors = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return {
          bg: 'bg-gradient-to-br from-accent-50 to-accent-100',
          border: 'border-accent-300',
          hover: 'hover:from-accent-100 hover:to-accent-200 hover:border-accent-400',
          text: 'text-accent-900',
          iconBg: 'bg-accent-500',
          statusIcon: CheckCircle2,
        };
      case TableStatus.OCCUPIED:
        return {
          bg: 'bg-gradient-to-br from-error-light to-error/20',
          border: 'border-error',
          hover: 'hover:from-error-light/90 hover:to-error/30 hover:border-error-dark',
          text: 'text-error-dark',
          iconBg: 'bg-error',
          statusIcon: AlertCircle,
        };
      case TableStatus.RESERVED:
        return {
          bg: 'bg-gradient-to-br from-warning-light to-warning/20',
          border: 'border-warning-dark',
          hover: 'hover:from-warning-light/90 hover:to-warning/30 hover:border-warning-dark',
          text: 'text-warning-dark',
          iconBg: 'bg-warning-dark',
          statusIcon: Clock,
        };
      default:
        return {
          bg: 'bg-gradient-to-br from-neutral-50 to-neutral-100',
          border: 'border-neutral-300',
          hover: 'hover:from-neutral-100 hover:to-neutral-200 hover:border-neutral-400',
          text: 'text-neutral-900',
          iconBg: 'bg-neutral-500',
          statusIcon: CheckCircle2,
        };
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('transfer.title')} size="xl">
      <div className="space-y-4">
        {/* Source Table Info */}
        <div className="flex items-center justify-between p-3 bg-primary-50 rounded-lg border border-primary-200">
          <div>
            <p className="text-xs text-primary-600 mb-1">{t('transfer.sourceTable')}</p>
            <p className="text-lg font-bold text-primary-700">
              {t('table')} {sourceTable.number}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-primary-600 mb-1">{t('transfer.activeOrders')}</p>
            <p className="text-lg font-bold text-primary-700">{orderCount}</p>
          </div>
        </div>

        {/* Instruction */}
        <p className="text-sm text-muted-foreground">{t('transfer.selectTarget')}</p>

        {/* Table Grid - Same as TableGrid component */}
        {isLoadingTables ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : availableTables.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            {t('transfer.noAvailableTables')}
          </div>
        ) : (
          <div className="max-h-[65vh] overflow-y-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
              {availableTables.map((table) => {
                const isSelected = selectedTarget?.id === table.id;
                const statusColors = getStatusColors(table.status);
                const StatusIcon = statusColors.statusIcon;

                return (
                  <Card
                    key={table.id}
                    interactive
                    onClick={() => setSelectedTarget(table)}
                    className={cn(
                      'p-3 sm:p-4 cursor-pointer transition-all duration-200 relative overflow-hidden',
                      'hover:shadow-lg hover:scale-[1.02] active:scale-[0.98]',
                      isSelected
                        ? 'ring-2 ring-primary-500 bg-primary-50 shadow-lg scale-[1.02] border-primary-400'
                        : `${statusColors.bg} ${statusColors.border} border-2 ${statusColors.hover} shadow-sm`
                    )}
                  >
                    {/* Status Indicator Bar - Top */}
                    <div className={cn(
                      'absolute top-0 left-0 right-0 h-1.5',
                      table.status === TableStatus.AVAILABLE ? 'bg-accent-500' :
                      table.status === TableStatus.OCCUPIED ? 'bg-error' :
                      'bg-warning-dark'
                    )} />

                    <div className="flex flex-col items-center justify-center h-full min-h-[120px]">
                      {/* Table Icon with Status Background */}
                      <div className={cn(
                        'mb-2 p-2 sm:p-2.5 rounded-xl shadow-lg relative',
                        statusColors.iconBg,
                        'text-white'
                      )}>
                        <TableIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                        {/* Small status indicator on icon */}
                        <div className="absolute -bottom-0.5 -right-0.5">
                          <div className={cn(
                            'rounded-full p-0.5 border-2 border-white',
                            table.status === TableStatus.AVAILABLE ? 'bg-accent-600' :
                            table.status === TableStatus.OCCUPIED ? 'bg-error' :
                            'bg-warning-dark'
                          )}>
                            <StatusIcon className="h-2 w-2 sm:h-2.5 sm:w-2.5 text-white" />
                          </div>
                        </div>
                      </div>

                      {/* Table Number - Smaller */}
                      <div className={cn(
                        'text-2xl sm:text-3xl font-black mb-1.5 w-full text-center truncate px-1',
                        isSelected ? 'text-primary-700' : statusColors.text
                      )} title={table.number}>
                        {table.number}
                      </div>

                      {/* Status Badge - Smaller */}
                      <div className="mb-1.5 w-full">
                        <Badge 
                          variant={getTableVariant(table.status)} 
                          className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 font-bold max-w-full truncate block"
                          title={t(`tableGrid.status.${table.status}`)}
                        >
                          <span className="truncate block">{t(`tableGrid.status.${table.status}`)}</span>
                        </Badge>
                      </div>

                      {/* Selected Indicator - Smaller */}
                      {isSelected && (
                        <div className="mt-1.5 text-primary-600 font-bold text-[10px] sm:text-xs flex items-center justify-center gap-1 bg-primary-100 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full w-full">
                          <CheckCircle2 className="h-3 w-3 sm:h-3.5 sm:w-3.5 flex-shrink-0" />
                          <span className="truncate">{t('transfer.selected')}</span>
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Warning for occupied table - Only show when selected */}
        {selectedTarget?.status === TableStatus.OCCUPIED && (
          <div className="flex items-start gap-3 bg-warning-50 border border-warning-200 rounded-lg p-4">
            <AlertCircle className="h-5 w-5 text-warning-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-medium text-warning-800 mb-1">
                {t('transfer.mergeWarningTitle')}
              </p>
              <p className="text-sm text-warning-700">
                {t('transfer.mergeWarningDescription')}
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-2 border-t border-neutral-200">
          <Button 
            variant="outline" 
            className="flex-1" 
            onClick={handleClose}
          >
            {t('common:app.cancel')}
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleConfirm}
            isLoading={isLoading}
            disabled={!selectedTarget}
            icon={ArrowRightLeft}
          >
            {t('transfer.confirm')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default TransferTableModal;
