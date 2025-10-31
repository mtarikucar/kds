import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Plus, Edit, Trash2 } from 'lucide-react';
import {
  useTables,
  useCreateTable,
  useUpdateTable,
  useDeleteTable,
} from '../../features/tables/tablesApi';
import { Table, TableStatus } from '../../types';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import Input from '../../components/ui/Input';
import Select from '../../components/ui/Select';
import Badge from '../../components/ui/Badge';
import Spinner from '../../components/ui/Spinner';
// import { getStatusColor } from '../../lib/utils';

const TableManagementPage = () => {
  const { t } = useTranslation('common');

  const tableSchema = z.object({
    number: z.string().min(1, t('admin.tableNumberRequired')),
    capacity: z.number().min(1, t('admin.capacityMin')),
    status: z.nativeEnum(TableStatus),
  });

  type TableFormData = z.infer<typeof tableSchema>;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTable, setEditingTable] = useState<Table | null>(null);

  const { data: tables, isLoading } = useTables();
  const { mutate: createTable } = useCreateTable();
  const { mutate: updateTable } = useUpdateTable();
  const { mutate: deleteTable } = useDeleteTable();

  const form = useForm<TableFormData>({
    resolver: zodResolver(tableSchema),
    defaultValues: {
      status: TableStatus.AVAILABLE,
    },
  });

  const handleOpenModal = (table?: Table) => {
    if (table) {
      setEditingTable(table);
      form.reset({
        number: table.number,
        capacity: table.capacity,
        status: table.status as TableStatus,
      });
    } else {
      setEditingTable(null);
      form.reset({
        number: '',
        capacity: 4,
        status: TableStatus.AVAILABLE,
      });
    }
    setModalOpen(true);
  };

  const handleSubmit = (data: TableFormData) => {
    const submitData = {
      ...data,
      capacity: Number(data.capacity),
      status: data.status as TableStatus,
    };

    console.log('Form data:', data);
    console.log('Submit data:', submitData);

    if (editingTable) {
      updateTable(
        { id: editingTable.id, data: submitData },
        {
          onSuccess: () => {
            setModalOpen(false);
            form.reset();
          },
        }
      );
    } else {
      createTable(submitData, {
        onSuccess: () => {
          setModalOpen(false);
          form.reset();
        },
      });
    }
  };

  const statusOptions = [
    { value: TableStatus.AVAILABLE, label: t('admin.available') },
    { value: TableStatus.OCCUPIED, label: t('admin.occupied') },
    { value: TableStatus.RESERVED, label: t('admin.reserved') },
  ];

  const getStatusVariant = (status: TableStatus) => {
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

  const getStatusLabel = (status: TableStatus) => {
    switch (status) {
      case TableStatus.AVAILABLE:
        return t('admin.available');
      case TableStatus.OCCUPIED:
        return t('admin.occupied');
      case TableStatus.RESERVED:
        return t('admin.reserved');
      default:
        return String(status);
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{t('admin.tableManagement')}</h1>
          <p className="text-gray-600">{t('admin.manageTablesSeating')}</p>
        </div>
        <Button onClick={() => handleOpenModal()}>
          <Plus className="h-4 w-4 mr-2" />
          {t('admin.addTable')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('admin.tables')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Spinner />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {tables?.map((table) => (
                <div
                  key={table.id}
                  className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="text-center mb-3">
                    <div className="text-2xl font-bold mb-2">
                      {t('admin.table')} {table.number}
                    </div>
                    <Badge variant={getStatusVariant(table.status as TableStatus)}>
                      {getStatusLabel(table.status as TableStatus)}
                    </Badge>
                    <div className="text-sm text-gray-600 mt-2">
                      {t('admin.capacity')}: {table.capacity} {t('admin.people')}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleOpenModal(table)}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      {t('app.edit')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (confirm(t('admin.deleteTableConfirm'))) {
                          deleteTable(table.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Table Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTable ? t('admin.editTable') : t('admin.addTable')}
      >
        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <Input
            label={t('admin.tableNumber')}
            placeholder={t('admin.tableNumberPlaceholder')}
            error={form.formState.errors.number?.message}
            {...form.register('number')}
          />
          <Input
            label={t('admin.capacity')}
            type="number"
            min="1"
            error={form.formState.errors.capacity?.message}
            {...form.register('capacity', { valueAsNumber: true })}
          />
          {/* @ts-ignore: Pass props via any spread to avoid TS mismatch with custom Select */}
          <Select
            {...({
              label: t('admin.status'),
              options: statusOptions,
              error: form.formState.errors.status?.message,
              ...form.register('status'),
            } as any)}
          />
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setModalOpen(false)}
            >
              {t('app.cancel')}
            </Button>
            <Button type="submit" className="flex-1">
              {editingTable ? t('app.update') : t('app.create')}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default TableManagementPage;
