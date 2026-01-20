import { useTables } from '../../features/tables/tablesApi';
import { usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';
import { Table, TableStatus } from '../../types';
import { Card } from '../ui/Card';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { Clock, User, Receipt, Users, CheckCircle2, AlertCircle, Table as TableIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

interface TableGridProps {
  selectedTable: Table | null;
  onSelectTable: (table: Table) => void;
}

const TableGrid = ({ selectedTable, onSelectTable }: TableGridProps) => {
  const { t } = useTranslation('pos');
  const { data: tables, isLoading } = useTables();
  const { data: pendingOrders = [] } = usePendingOrders();
  const { data: waiterRequests = [] } = useWaiterRequests();
  const { data: billRequests = [] } = useBillRequests();

  const getTableNotifications = (tableId: string) => {
    const orders = pendingOrders.filter(order => order.tableId === tableId).length;
    const waiter = waiterRequests.filter(req => req.tableId === tableId).length;
    const bill = billRequests.filter(req => req.tableId === tableId).length;
    return { orders, waiter, bill };
  };

  if (isLoading) {
    return <Spinner />;
  }

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
          statusIcon: Users,
        };
    }
  };

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4 md:gap-5">
      {tables?.map((table) => {
        const notifications = getTableNotifications(table.id);
        const hasNotifications = notifications.orders > 0 || notifications.waiter > 0 || notifications.bill > 0;
        const isSelected = selectedTable?.id === table.id;
        const statusColors = getStatusColors(table.status);
        const StatusIcon = statusColors.statusIcon;
        const totalNotifications = notifications.orders + notifications.waiter + notifications.bill;

        return (
          <Card
            key={table.id}
            interactive
            onClick={() => onSelectTable(table)}
            className={cn(
              'p-4 sm:p-5 md:p-6 cursor-pointer transition-all duration-200 relative overflow-hidden',
              'hover:shadow-2xl hover:scale-[1.03] active:scale-[0.97]',
              isSelected
                ? 'ring-4 ring-primary-500 bg-primary-50 shadow-2xl scale-[1.03] border-primary-400'
                : hasNotifications
                ? `ring-2 ring-warning-dark ${statusColors.bg} ${statusColors.border} border-2 shadow-lg`
                : `${statusColors.bg} ${statusColors.border} border-2 ${statusColors.hover} shadow-md`
            )}
          >
            {/* Status Indicator Bar - Top */}
            <div className={cn(
              'absolute top-0 left-0 right-0 h-1.5',
              table.status === TableStatus.AVAILABLE ? 'bg-accent-500' :
              table.status === TableStatus.OCCUPIED ? 'bg-error' :
              'bg-warning-dark'
            )} />

            {/* Notification Count Badge - Top Right */}
            {totalNotifications > 0 && (
              <div className="absolute top-2 right-2 z-10">
                <div className="bg-error text-white rounded-full h-6 w-6 flex items-center justify-center shadow-lg border-2 border-white text-xs font-bold">
                  {totalNotifications}
                </div>
              </div>
            )}
            <div className="flex flex-col items-center justify-center h-full min-h-[140px] sm:min-h-[160px]">
              {/* Table Icon with Status Background */}
              <div className={cn(
                'mb-3 p-3 sm:p-4 rounded-2xl shadow-lg relative',
                statusColors.iconBg,
                'text-white'
              )}>
                <TableIcon className="h-6 w-6 sm:h-7 sm:w-7" />
                {/* Small status indicator on icon */}
                <div className="absolute -bottom-1 -right-1">
                  <div className={cn(
                    'rounded-full p-1 border-2 border-white',
                    table.status === TableStatus.AVAILABLE ? 'bg-accent-600' :
                    table.status === TableStatus.OCCUPIED ? 'bg-error' :
                    'bg-warning-dark'
                  )}>
                    <StatusIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-white" />
                  </div>
                </div>
              </div>

              {/* Table Number - Large and Bold with truncate */}
              <div className={cn(
                'text-3xl sm:text-4xl md:text-5xl font-black mb-2 sm:mb-3 w-full text-center truncate px-1',
                isSelected ? 'text-primary-700' : statusColors.text
              )} title={table.number}>
                {table.number}
              </div>

              {/* Status Badge - with truncate */}
              <div className="mb-2 sm:mb-3 w-full">
                <Badge 
                  variant={getTableVariant(table.status)} 
                  className="text-xs sm:text-sm px-2 sm:px-3 py-1 sm:py-1.5 font-bold max-w-full truncate block"
                  title={t(`tableGrid.status.${table.status}`)}
                >
                  <span className="truncate block">{t(`tableGrid.status.${table.status}`)}</span>
                </Badge>
              </div>

              {/* Capacity with Icon - with truncate */}
              <div className={cn(
                'text-xs sm:text-sm flex items-center justify-center gap-1.5 font-semibold mb-2 w-full px-1',
                isSelected ? 'text-primary-600' : 'text-muted-foreground'
              )}>
                <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                <span className="truncate">{table.capacity} {t('people', 'kişi')}</span>
              </div>

              {/* Notification Pills - Compact */}
              {hasNotifications && (
                <div className="mt-auto pt-2 sm:pt-3 w-full space-y-1.5 px-1">
                  {notifications.orders > 0 && (
                    <div className="flex items-center justify-center gap-1.5 bg-warning-light/70 text-warning-dark px-2 py-1 rounded-full text-xs font-semibold truncate">
                      <Clock className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{notifications.orders}</span>
                    </div>
                  )}
                  {notifications.waiter > 0 && (
                    <div className="flex items-center justify-center gap-1.5 bg-primary-100 text-primary-700 px-2 py-1 rounded-full text-xs font-semibold truncate">
                      <User className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{notifications.waiter}</span>
                    </div>
                  )}
                  {notifications.bill > 0 && (
                    <div className="flex items-center justify-center gap-1.5 bg-purple-100 text-purple-700 px-2 py-1 rounded-full text-xs font-semibold truncate">
                      <Receipt className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{notifications.bill}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Selected Indicator - Bottom with truncate */}
              {isSelected && (
                <div className="mt-2 sm:mt-3 text-primary-600 font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 bg-primary-100 px-2 sm:px-3 py-1 sm:py-1.5 rounded-full w-full">
                  <CheckCircle2 className="h-3.5 w-3.5 sm:h-4 sm:w-4 flex-shrink-0" />
                  <span className="truncate">{t('tableGrid.selected')}</span>
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
};

export default TableGrid;
