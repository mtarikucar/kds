import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Users, Search } from 'lucide-react';
import api from '../../lib/api';
import type { PublicTable, TableStatus } from '../../types';

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTable: (tableId: string) => void;
  tenantId: string;
  primaryColor: string;
  secondaryColor: string;
}

export default function TableSelectionModal({
  isOpen,
  onClose,
  onSelectTable,
  tenantId,
  primaryColor,
  secondaryColor,
}: TableSelectionModalProps) {
  const { t } = useTranslation('common');
  const [tables, setTables] = useState<PublicTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchTables();
    }
  }, [isOpen, tenantId]);

  const fetchTables = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await api.get(`/tables/public/${tenantId}`);
      setTables(response.data);
    } catch (err: any) {
      console.error('Failed to fetch tables:', err);
      setError(err.response?.data?.message || 'Failed to load tables');
    } finally {
      setLoading(false);
    }
  };

  const filteredTables = tables.filter((table) =>
    table.number.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectTable = () => {
    if (selectedTableId) {
      onSelectTable(selectedTableId);
    }
  };

  const getStatusColor = (status: TableStatus) => {
    switch (status) {
      case 'AVAILABLE':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'OCCUPIED':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusLabel = (status: TableStatus) => {
    return t(`tableSelection.${status.toLowerCase()}`);
  };

  if (!isOpen) return null;

  const useGridLayout = tables.length < 12;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderBottomColor: secondaryColor + '30' }}
        >
          <div>
            <h2
              className="text-2xl font-bold"
              style={{ color: primaryColor }}
            >
              {t('tableSelection.title')}
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              {t('tableSelection.description')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-gray-800"></div>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800">
              {error}
            </div>
          )}

          {!loading && !error && tables.length === 0 && (
            <div className="text-center py-12">
              <p className="text-gray-500">{t('tableSelection.noTablesAvailable')}</p>
            </div>
          )}

          {!loading && !error && tables.length > 0 && (
            <>
              {/* Search (only for dropdown layout) */}
              {!useGridLayout && (
                <div className="mb-4 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t('tableSelection.searchPlaceholder')}
                    className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2"
                    style={{ focusRingColor: primaryColor }}
                  />
                </div>
              )}

              {/* Grid Layout (<12 tables) */}
              {useGridLayout && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {filteredTables.map((table) => (
                    <button
                      key={table.id}
                      onClick={() => setSelectedTableId(table.id)}
                      className={`
                        p-4 rounded-xl border-2 transition-all duration-200
                        hover:shadow-lg hover:scale-105
                        ${selectedTableId === table.id
                          ? 'ring-4 ring-offset-2'
                          : 'hover:border-gray-400'
                        }
                        ${getStatusColor(table.status)}
                      `}
                      style={
                        selectedTableId === table.id
                          ? {
                              borderColor: primaryColor,
                              ringColor: primaryColor + '40',
                            }
                          : {}
                      }
                    >
                      <div className="text-center">
                        <div className="text-2xl font-bold mb-1">
                          {table.number}
                        </div>
                        <div className="flex items-center justify-center text-sm gap-1">
                          <Users className="w-4 h-4" />
                          <span>{table.capacity}</span>
                        </div>
                        <div className="text-xs mt-2 font-medium">
                          {getStatusLabel(table.status)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Dropdown Layout (≥12 tables) */}
              {!useGridLayout && (
                <div className="space-y-2">
                  <select
                    value={selectedTableId || ''}
                    onChange={(e) => setSelectedTableId(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-offset-2"
                    style={{ focusRingColor: primaryColor }}
                  >
                    <option value="">{t('tableSelection.selectDropdown')}</option>
                    {filteredTables.map((table) => (
                      <option key={table.id} value={table.id}>
                        {t('tableSelection.tableNumber')} {table.number} - {t('tableSelection.capacity')}: {table.capacity} - {getStatusLabel(table.status)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!loading && !error && tables.length > 0 && (
          <div
            className="px-6 py-4 border-t flex items-center justify-end gap-3"
            style={{ borderTopColor: secondaryColor + '30' }}
          >
            <button
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg font-medium border border-gray-300 hover:bg-gray-50 transition-colors"
            >
              {t('tableSelection.cancel')}
            </button>
            <button
              onClick={handleSelectTable}
              disabled={!selectedTableId}
              className="px-6 py-2.5 rounded-lg font-medium text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:shadow-lg"
              style={{
                backgroundColor: primaryColor,
                opacity: selectedTableId ? 1 : 0.5,
              }}
            >
              {t('tableSelection.selectTable')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
