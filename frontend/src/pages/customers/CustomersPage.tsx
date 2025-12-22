import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCustomers, useDeleteCustomer } from '../../features/customers/customersApi';
import Button from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import CustomerFormModal from '../../components/customers/CustomerFormModal';
import { Customer } from '../../types';

const CustomersPage = () => {
  const { t } = useTranslation('customers');
  const navigate = useNavigate();
  const { data: customers = [], isLoading } = useCustomers();
  const { mutate: deleteCustomer } = useDeleteCustomer();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  const filteredCustomers = customers.filter((customer: Customer) =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone?.includes(searchTerm)
  );

  const handleDelete = (id: string, name: string) => {
    if (window.confirm(`${t('app:messages.confirmDelete')} ${name}?`)) {
      deleteCustomer(id);
    }
  };

  const handleAddCustomer = () => {
    setSelectedCustomer(null);
    setIsModalOpen(true);
  };

  const handleEditCustomer = (customer: Customer) => {
    setSelectedCustomer(customer);
    setIsModalOpen(true);
  };

  const handleViewCustomer = (id: string) => {
    navigate(`/customers/${id}`);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">{t('app:app.loading')}</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 md:p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 md:mb-6">
        <h1 className="text-2xl md:text-3xl font-bold">{t('customers.title')}</h1>
        <Button size="sm" className="sm:text-base" onClick={handleAddCustomer}>
          {t('customers.addCustomer')}
        </Button>
      </div>

      {/* Search */}
      <Card className="mb-4 md:mb-6">
        <CardContent className="pt-4 md:pt-6">
          <input
            type="text"
            placeholder={t('customers.search')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 md:px-4 py-2 text-sm md:text-base border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </CardContent>
      </Card>

      {/* Customer List */}
      <div className="grid gap-3 md:gap-4">
        {filteredCustomers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              {searchTerm ? t('customers.noCustomers') : t('customers.noCustomers')}
            </CardContent>
          </Card>
        ) : (
          filteredCustomers.map((customer: Customer) => (
            <Card key={customer.id}>
              <CardContent className="py-3 md:py-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex-1 min-w-0 w-full sm:w-auto">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-base md:text-lg truncate">{customer.name}</h3>
                        <div className="flex flex-col sm:flex-row sm:gap-4 text-xs md:text-sm text-gray-600 mt-1">
                          {customer.email && <span className="truncate">{customer.email}</span>}
                          {customer.phone && <span>{customer.phone}</span>}
                        </div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="flex flex-wrap gap-3 md:gap-6 mt-2 md:mt-3 text-xs md:text-sm">
                      <div>
                        <span className="text-gray-600">{t('customers.totalOrders')}:</span>
                        <span className="ml-1 font-medium">{customer.totalOrders || 0}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">{t('customers.totalSpent')}:</span>
                        <span className="ml-1 font-medium">${customer.totalSpent || '0.00'}</span>
                      </div>
                      <div>
                        <span className="text-gray-600">{t('customers.loyaltyPoints', 'Points')}:</span>
                        <span className="ml-1 font-medium">{customer.loyaltyPoints || 0}</span>
                      </div>
                    </div>

                    {/* Tags */}
                    {customer.tags && customer.tags.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {customer.tags.map((tag: string) => (
                          <span
                            key={tag}
                            className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 sm:flex-none"
                      onClick={() => handleViewCustomer(customer.id)}
                    >
                      {t('app:app.view')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 sm:flex-none"
                      onClick={() => handleEditCustomer(customer)}
                    >
                      {t('app:app.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(customer.id, customer.name)}
                      className="flex-1 sm:flex-none"
                    >
                      {t('app:app.delete')}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Summary */}
      {customers.length > 0 && (
        <Card className="mt-4 md:mt-6">
          <CardHeader>
            <CardTitle className="text-lg md:text-xl">{t('customers.summary', 'Summary')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4 text-center">
              <div className="p-3 bg-blue-50 rounded-lg sm:bg-transparent sm:p-0">
                <p className="text-xl md:text-2xl font-bold text-blue-600">{customers.length}</p>
                <p className="text-xs md:text-sm text-gray-600">{t('customers.title')}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg sm:bg-transparent sm:p-0">
                <p className="text-xl md:text-2xl font-bold text-green-600">
                  ${customers.reduce((sum: number, c: Customer) => sum + (parseFloat(String(c.totalSpent)) || 0), 0).toFixed(2)}
                </p>
                <p className="text-xs md:text-sm text-gray-600">{t('customers.totalSpent')}</p>
              </div>
              <div className="p-3 bg-purple-50 rounded-lg sm:bg-transparent sm:p-0">
                <p className="text-xl md:text-2xl font-bold text-purple-600">
                  {customers.reduce((sum: number, c: Customer) => sum + (c.totalOrders || 0), 0)}
                </p>
                <p className="text-xs md:text-sm text-gray-600">{t('customers.totalOrders')}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Customer Form Modal */}
      <CustomerFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        customer={selectedCustomer}
      />
    </div>
  );
};

export default CustomersPage;
