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
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {tables?.map((table) => (
        <Card
          key={table.id}
          className={`p-4 cursor-pointer transition-all hover:shadow-md ${
            selectedTable?.id === table.id
              ? 'ring-2 ring-blue-500 bg-blue-50'
              : ''
          }`}
          onClick={() => onSelectTable(table)}
        >
          <div className="text-center">
            <div className="text-2xl font-bold mb-2">Table {table.number}</div>
            <Badge variant={getTableVariant(table.status)}>
              {table.status}
            </Badge>
            <div className="text-sm text-gray-500 mt-2">
              Capacity: {table.capacity}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default TableGrid;
