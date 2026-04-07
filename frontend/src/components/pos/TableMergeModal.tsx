import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Combine, X, Check, Scissors } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Spinner from '../ui/Spinner';
import { useTables } from '../../features/tables/tablesApi';
import { Table } from '../../types';

interface TableMergeModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTable?: Table | null;
  onMerge: (tableIds: string[]) => void;
  onUnmerge: (tableId: string) => void;
  onUnmergeAll: (groupId: string) => void;
  isLoading?: boolean;
}

const TableMergeModal = ({
  isOpen,
  onClose,
  currentTable,
  onMerge,
  onUnmerge,
  onUnmergeAll,
  isLoading = false,
}: TableMergeModalProps) => {
  const { t } = useTranslation('pos');
  const { data: tables, isLoading: isLoadingTables } = useTables();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset selection when table changes
  useEffect(() => {
    setSelectedIds(new Set());
  }, [currentTable?.id]);

  const isInGroup = !!currentTable?.groupId;
  const groupTables = isInGroup
    ? (tables || []).filter(t => t.groupId === currentTable?.groupId)
    : [];

  const availableForMerge = (tables || []).filter(
    t => t.id !== currentTable?.id && t.status !== 'RESERVED'
  );

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  const handleMerge = () => {
    if (!currentTable) return;
    const ids = [currentTable.id, ...Array.from(selectedIds)];
    onMerge(ids);
    setSelectedIds(new Set());
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('tableMerge.title')}>
      <div className="space-y-6">
        {/* Current group info */}
        {isInGroup && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Combine className="h-5 w-5 text-indigo-600" />
                <span className="font-semibold text-indigo-900">
                  {t('tableMerge.mergedGroup')}
                </span>
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onUnmergeAll(currentTable!.groupId!)}
                disabled={isLoading}
              >
                <Scissors className="h-3.5 w-3.5 mr-1" />
                {t('tableMerge.unmergeAllButton')}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {groupTables.map(gt => (
                <div
                  key={gt.id}
                  className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 border border-indigo-100"
                >
                  <span className="font-medium text-slate-900">
                    {t('tableLabel')} {gt.number}
                  </span>
                  {gt.id !== currentTable?.id && (
                    <button
                      onClick={() => onUnmerge(gt.id)}
                      disabled={isLoading}
                      className="p-0.5 rounded hover:bg-red-100 text-slate-400 hover:text-red-600 transition-colors"
                      title={t('tableMerge.unmergeButton')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Select tables to merge */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">
            {t('tableMerge.selectTables')}
          </h3>

          {isLoadingTables ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
              {availableForMerge.map(table => {
                const isSelected = selectedIds.has(table.id);
                const isOccupied = table.status === 'OCCUPIED';
                const isSameGroup = isInGroup && table.groupId === currentTable?.groupId;

                if (isSameGroup) return null;

                return (
                  <button
                    key={table.id}
                    onClick={() => toggleSelect(table.id)}
                    className={`relative p-3 rounded-xl border-2 transition-all text-center ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-200'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-1 right-1">
                        <Check className="h-4 w-4 text-indigo-600" />
                      </div>
                    )}
                    <div className="font-bold text-slate-900">{table.number}</div>
                    <div className={`text-xs mt-1 ${
                      isOccupied ? 'text-red-500' : 'text-green-500'
                    }`}>
                      {isOccupied ? t('tableStatuses.occupied') : t('tableStatuses.available')}
                    </div>
                    {table.groupId && (
                      <div className="text-xs text-indigo-500 mt-0.5">
                        {t('tableMerge.mergedWith')}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {selectedIds.size === 0 && (
            <p className="text-sm text-slate-400 mt-2">{t('tableMerge.selectAtLeast')}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2 border-t">
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t('common:common.cancel', 'Cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={handleMerge}
            disabled={isLoading || selectedIds.size === 0}
          >
            {isLoading ? (
              <Spinner size="sm" color="white" />
            ) : (
              <>
                <Combine className="h-4 w-4 mr-2" />
                {t('tableMerge.mergeButton')}
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
};

export default TableMergeModal;
