import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useCustomers, useDeleteCustomer } from '../../features/customers/customersApi';
import Button from '../../components/ui/Button';
import { Card, CardContent } from '../../components/ui/Card';
import Modal from '../../components/ui/Modal';
import CustomerFormModal from '../../components/customers/CustomerFormModal';
import { Customer } from '../../types';
import { Users, DollarSign, ShoppingBag, Star, AlertTriangle, Plus } from 'lucide-react';
import { useCurrency, SUPPORTED_CURRENCIES } from '../../hooks/useCurrency';

const CustomersPage = () => {
  const { t } = useTranslation('customers');
  const navigate = useNavigate();
  const { data: customers = [], isLoading } = useCustomers();
  const { mutate: deleteCustomer } = useDeleteCustomer();
  const currencyCode = useCurrency();
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);

  // Format currency based on tenant settings
  const formatCurrency = useCallback((amount: number) => {
    const currency = SUPPORTED_CURRENCIES.find(c => c.code === currencyCode);
    const symbol = currency?.symbol || '₺';
    return `${symbol}${amount.toFixed(2)}`;
  }, [currencyCode]);

  const filteredCustomers = customers.filter((customer: Customer) =>
    customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    customer.phone?.includes(searchTerm)
  );

  // Calculate statistics
  const stats = useMemo(() => {
    return {
      totalCustomers: customers.length,
      totalSpent: customers.reduce((sum: number, c: Customer) => sum + (parseFloat(String(c.totalSpent)) || 0), 0),
      totalOrders: customers.reduce((sum: number, c: Customer) => sum + (c.totalOrders || 0), 0),
      totalPoints: customers.reduce((sum: number, c: Customer) => sum + (c.loyaltyPoints || 0), 0),
    };
  }, [customers]);

  const handleDeleteClick = (customer: Customer) => {
    setCustomerToDelete(customer);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = () => {
    if (customerToDelete) {
      deleteCustomer(customerToDelete.id);
      setShowDeleteModal(false);
      setCustomerToDelete(null);
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
        <div className="text-slate-600">{t('common:app.loading')}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-lg shadow-primary-500/20">
            <Users className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-heading font-bold text-slate-900">{t('customers.title')}</h1>
            <p className="text-slate-500 mt-0.5">{t('customers.manageCustomers')}</p>
          </div>
        </div>
        <Button onClick={handleAddCustomer}>
          <Plus className="h-4 w-4 mr-2" />
          {t('customers.addCustomer')}
        </Button>
      </div>

      {/* Statistics Overview */}
      {customers.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Total Customers */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
              <Users className="w-6 h-6 text-slate-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{stats.totalCustomers}</p>
              <p className="text-sm text-slate-500">{t('customers.title')}</p>
            </div>
          </div>

          {/* Total Spent */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center">
              <DollarSign className="w-6 h-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{formatCurrency(stats.totalSpent)}</p>
              <p className="text-sm text-slate-500">{t('customers.totalSpent')}</p>
            </div>
          </div>

          {/* Total Orders */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-primary-100 flex items-center justify-center">
              <ShoppingBag className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-primary-600">{stats.totalOrders}</p>
              <p className="text-sm text-slate-500">{t('customers.totalOrders')}</p>
            </div>
          </div>

          {/* Total Points */}
          <div className="bg-white rounded-xl border border-slate-200/60 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-100 flex items-center justify-center">
              <Star className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-purple-600">{stats.totalPoints}</p>
              <p className="text-sm text-slate-500">{t('customers.loyaltyPoints')}</p>
            </div>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200/60 p-4">
        <input
          type="text"
          placeholder={t('customers.search')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Customer List */}
      <div className="grid gap-4">
        {filteredCustomers.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/60 py-16 text-center">
            <div className="mx-auto w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <Users className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">
              {searchTerm ? t('customers.noSearchResults') : t('customers.noCustomers')}
            </h3>
            <p className="mt-2 text-sm text-slate-500 max-w-sm mx-auto">
              {searchTerm ? t('customers.noSearchResultsDescription') : t('customers.noCustomersDescription')}
            </p>
            {!searchTerm && (
              <Button className="mt-6" onClick={handleAddCustomer}>
                <Plus className="h-4 w-4 mr-2" />
                {t('customers.addFirstCustomer')}
              </Button>
            )}
          </div>
        ) : (
          filteredCustomers.map((customer: Customer) => (
            <div
              key={customer.id}
              className="group bg-white rounded-xl border border-slate-200/60 p-4 hover:shadow-lg hover:border-primary-200 transition-all duration-300"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0 w-full sm:w-auto">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white font-semibold text-sm">
                      {customer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-base text-slate-900 truncate">{customer.name}</h3>
                      <div className="flex flex-col sm:flex-row sm:gap-4 text-xs text-slate-500 mt-0.5">
                        {customer.email && <span className="truncate">{customer.email}</span>}
                        {customer.phone && <span>{customer.phone}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap gap-4 mt-3 text-sm">
                    <div className="flex items-center gap-1.5">
                      <ShoppingBag className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-600">{customer.totalOrders || 0}</span>
                      <span className="text-slate-400">{t('customers.orders')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-4 h-4 text-emerald-500" />
                      <span className="text-slate-600 font-medium">{formatCurrency(Number(customer.totalSpent) || 0)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Star className="w-4 h-4 text-amber-500" />
                      <span className="text-slate-600">{customer.loyaltyPoints || 0}</span>
                      <span className="text-slate-400">{t('customers.points')}</span>
                    </div>
                  </div>

                  {/* Tags */}
                  {customer.tags && customer.tags.length > 0 && (
                    <div className="flex gap-2 mt-3 flex-wrap">
                      {customer.tags.map((tag: string) => (
                        <span
                          key={tag}
                          className="px-2 py-1 text-xs font-medium bg-primary-100 text-primary-800 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2 w-full sm:w-auto opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-200">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => handleViewCustomer(customer.id)}
                  >
                    {t('common:app.view')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 sm:flex-none"
                    onClick={() => handleEditCustomer(customer)}
                  >
                    {t('common:app.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1 sm:flex-none text-red-500 hover:bg-red-50 hover:text-red-600"
                    onClick={() => handleDeleteClick(customer)}
                  >
                    {t('common:app.delete')}
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Customer Form Modal */}
      <CustomerFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        customer={selectedCustomer}
      />

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => {
          setShowDeleteModal(false);
          setCustomerToDelete(null);
        }}
        title={t('customers.deleteCustomer')}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-red-100 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">{t('customers.deleteCustomer')}</h3>
              <p className="text-sm text-slate-500">{t('common:messages.actionCannotBeUndone')}</p>
            </div>
          </div>

          <p className="text-slate-700">
            {t('common:messages.confirmDeleteCustomer')} <strong>{customerToDelete?.name}</strong>?
          </p>

          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowDeleteModal(false);
                setCustomerToDelete(null);
              }}
            >
              {t('common:app.cancel')}
            </Button>
            <Button
              variant="danger"
              className="flex-1"
              onClick={handleDeleteConfirm}
            >
              {t('common:app.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default CustomersPage;
