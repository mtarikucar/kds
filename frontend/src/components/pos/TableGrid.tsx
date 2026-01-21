import { useTables } from '../../features/tables/tablesApi';
import { usePendingOrders, useWaiterRequests, useBillRequests } from '../../features/orders/ordersApi';
import { Table, TableStatus } from '../../types';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
import { Clock, User, Receipt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-3 md:gap-4">
      {tables?.map((table) => {
        const notifications = getTableNotifications(table.id);
        const hasNotifications = notifications.orders > 0 || notifications.waiter > 0 || notifications.bill > 0;
        const isSelected = selectedTable?.id === table.id;

        return (
          <button
            key={table.id}
            className={`relative p-5 md:p-6 rounded-xl transition-all duration-200 text-left ${
              isSelected
                ? 'bg-primary-50 border-2 border-primary-400 shadow-md ring-2 ring-primary-500/20'
                : table.status === TableStatus.OCCUPIED
                ? 'bg-white border-2 border-slate-200 hover:border-primary-300 hover:shadow-md'
                : hasNotifications
                ? 'bg-white border-2 border-amber-300 hover:border-amber-400 hover:shadow-md'
                : 'bg-white border-2 border-slate-200 hover:border-slate-300 hover:shadow-md'
            }`}
            onClick={() => onSelectTable(table)}
          >
            {/* Notification Badges - Top Right Corner */}
            {hasNotifications && (
              <div className="absolute -top-2 -right-2 flex gap-1">
                {notifications.orders > 0 && (
                  <div className="bg-amber-500 text-white rounded-full h-7 w-7 flex items-center justify-center shadow-lg ring-2 ring-white">
                    <Clock className="h-3.5 w-3.5" />
                  </div>
                )}
                {notifications.waiter > 0 && (
                  <div className="bg-blue-500 text-white rounded-full h-7 w-7 flex items-center justify-center shadow-lg ring-2 ring-white">
                    <User className="h-3.5 w-3.5" />
                  </div>
                )}
                {notifications.bill > 0 && (
                  <div className="bg-purple-500 text-white rounded-full h-7 w-7 flex items-center justify-center shadow-lg ring-2 ring-white">
                    <Receipt className="h-3.5 w-3.5" />
                  </div>
                )}
              </div>
            )}

            <div className="text-center">
              {/* Table Number */}
              <div className={`text-3xl md:text-4xl font-bold mb-3 ${isSelected ? 'text-primary-700' : 'text-slate-900'}`}>
                {table.number}
              </div>

              {/* Status Badge */}
              <div className="mb-3">
                <Badge variant={getTableVariant(table.status)} className="text-sm px-3 py-1">
                  {t(`tableGrid.status.${table.status}`)}
                </Badge>
              </div>

              {/* Capacity */}
              <div className="text-sm md:text-base text-slate-500 flex items-center justify-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                <span className="font-medium">{table.capacity}</span>
              </div>

              {/* Notification Details */}
              {hasNotifications && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1">
                  {notifications.orders > 0 && (
                    <div className="text-xs font-semibold text-amber-600 flex items-center justify-center gap-1">
                      <Clock className="h-3 w-3" />
                      {notifications.orders} {notifications.orders !== 1 ? t('tableGrid.pendingOrders') : t('tableGrid.pendingOrder')}
                    </div>
                  )}
                  {notifications.waiter > 0 && (
                    <div className="text-xs font-semibold text-blue-600 flex items-center justify-center gap-1">
                      <User className="h-3 w-3" />
                      {notifications.waiter} {notifications.waiter !== 1 ? t('tableGrid.waiterCalls') : t('tableGrid.waiterCall')}
                    </div>
                  )}
                  {notifications.bill > 0 && (
                    <div className="text-xs font-semibold text-purple-600 flex items-center justify-center gap-1">
                      <Receipt className="h-3 w-3" />
                      {notifications.bill} {notifications.bill !== 1 ? t('tableGrid.billRequests') : t('tableGrid.billRequest')}
                    </div>
                  )}
                </div>
              )}

              {/* Selected Indicator */}
              {isSelected && (
                <div className="mt-3 text-primary-600 font-semibold text-sm flex items-center justify-center gap-1">
                  <svg
                    className="w-4 h-4"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {t('tableGrid.selected')}
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default TableGrid;
