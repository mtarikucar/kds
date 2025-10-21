import { useTables } from '../../features/tables/tablesApi';
import { Table, TableStatus } from '../../types';
import { Card } from '../ui/Card';
import Badge from '../ui/Badge';
import Spinner from '../ui/Spinner';
// import { getStatusColor } from '../../lib/utils';

interface TableGridProps {
  selectedTable: Table | null;
  onSelectTable: (table: Table) => void;
}

const TableGrid = ({ selectedTable, onSelectTable }: TableGridProps) => {
  const { data: tables, isLoading } = useTables();

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
      {tables?.map((table) => (
        <Card
          key={table.id}
          className={`p-5 md:p-6 cursor-pointer transition-all hover:shadow-lg hover:scale-105 ${
            selectedTable?.id === table.id
              ? 'ring-4 ring-blue-500 bg-blue-50 shadow-lg scale-105'
              : 'hover:ring-2 hover:ring-gray-300'
          }`}
          onClick={() => onSelectTable(table)}
        >
          <div className="text-center">
            {/* Table Number - Larger, more prominent */}
            <div className="text-3xl md:text-4xl font-bold mb-3 text-gray-900">
              {table.number}
            </div>

            {/* Status Badge - Larger */}
            <div className="mb-3">
              <Badge variant={getTableVariant(table.status)} className="text-sm px-3 py-1">
                {table.status}
              </Badge>
            </div>

            {/* Capacity - More readable */}
            <div className="text-sm md:text-base text-gray-600 flex items-center justify-center gap-1">
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

            {/* Selected Indicator */}
            {selectedTable?.id === table.id && (
              <div className="mt-3 text-blue-600 font-semibold text-sm flex items-center justify-center gap-1">
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
                Selected
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
};

export default TableGrid;
