import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Edit, Trash2, Mail, Phone, Calendar, Award, ShoppingBag } from 'lucide-react';
import { useCustomer, useDeleteCustomer } from '../../features/customers/customersApi';
import Button from '../../components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import CustomerFormModal from '../../components/customers/CustomerFormModal';
import { Customer } from '../../types';

const CustomerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('customers');
  const { data: customer, isLoading } = useCustomer(id || '');
  const { mutate: deleteCustomer } = useDeleteCustomer();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const handleDelete = () => {
    if (customer && window.confirm(`${t('app:messages.confirmDelete')} ${customer.name}?`)) {
      deleteCustomer(customer.id, {
        onSuccess: () => navigate('/customers'),
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-gray-600">{t('app:app.loading')}</div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="container mx-auto p-4 md:p-6">
        <div className="text-center text-gray-500">
          {t('customers.noCustomers')}
        </div>
      </div>
    );
  }

  const typedCustomer = customer as Customer;

  return (
    <div className="container mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => navigate('/customers')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl md:text-3xl font-bold">{typedCustomer.name}</h1>
          {typedCustomer.loyaltyTier && (
            <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded font-medium">
              {typedCustomer.loyaltyTier}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setIsEditModalOpen(true)}>
            <Edit className="h-4 w-4 mr-1" />
            {t('customers.editCustomer')}
          </Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-1" />
            {t('customers.deleteCustomer')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('customers.contactInfo', 'Contact Information')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {typedCustomer.email && (
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-gray-400" />
                <span>{typedCustomer.email}</span>
              </div>
            )}
            {typedCustomer.phone && (
              <div className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 text-gray-400" />
                <span>{typedCustomer.phone}</span>
                {typedCustomer.phoneVerified && (
                  <span className="text-xs text-green-600">({t('customers.verified', 'Verified')})</span>
                )}
              </div>
            )}
            {typedCustomer.birthday && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span>{new Date(typedCustomer.birthday).toLocaleDateString()}</span>
              </div>
            )}
            {!typedCustomer.email && !typedCustomer.phone && (
              <p className="text-sm text-gray-500">{t('customers.noContactInfo', 'No contact information')}</p>
            )}
          </CardContent>
        </Card>

        {/* Statistics */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('customers.statistics', 'Statistics')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-blue-50 rounded-lg">
                <ShoppingBag className="h-5 w-5 mx-auto mb-1 text-blue-600" />
                <p className="text-xl font-bold text-blue-600">{typedCustomer.totalOrders || 0}</p>
                <p className="text-xs text-gray-600">{t('customers.totalOrders')}</p>
              </div>
              <div className="text-center p-3 bg-green-50 rounded-lg">
                <span className="text-xl font-bold text-green-600">
                  ${parseFloat(String(typedCustomer.totalSpent || 0)).toFixed(2)}
                </span>
                <p className="text-xs text-gray-600">{t('customers.totalSpent')}</p>
              </div>
              <div className="text-center p-3 bg-purple-50 rounded-lg">
                <Award className="h-5 w-5 mx-auto mb-1 text-purple-600" />
                <p className="text-xl font-bold text-purple-600">{typedCustomer.loyaltyPoints || 0}</p>
                <p className="text-xs text-gray-600">{t('customers.loyaltyPoints', 'Loyalty Points')}</p>
              </div>
              <div className="text-center p-3 bg-orange-50 rounded-lg">
                <span className="text-xl font-bold text-orange-600">
                  ${parseFloat(String(typedCustomer.averageOrder || 0)).toFixed(2)}
                </span>
                <p className="text-xs text-gray-600">{t('customers.avgOrder', 'Avg Order')}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tags & Notes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('customers.tagsNotes', 'Tags & Notes')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {typedCustomer.tags && typedCustomer.tags.length > 0 && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {typedCustomer.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {typedCustomer.notes && (
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">{t('customers.notes')}</p>
                <p className="text-sm text-gray-600">{typedCustomer.notes}</p>
              </div>
            )}
            {(!typedCustomer.tags || typedCustomer.tags.length === 0) && !typedCustomer.notes && (
              <p className="text-sm text-gray-500">{t('customers.noTagsNotes', 'No tags or notes')}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Order History */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg">{t('customers.viewHistory')}</CardTitle>
        </CardHeader>
        <CardContent>
          {typedCustomer.orders && typedCustomer.orders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium">{t('customers.orderNumber', 'Order #')}</th>
                    <th className="text-left py-2 px-3 font-medium">{t('customers.date', 'Date')}</th>
                    <th className="text-left py-2 px-3 font-medium">{t('customers.status', 'Status')}</th>
                    <th className="text-right py-2 px-3 font-medium">{t('customers.amount', 'Amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(typedCustomer.orders as any[]).map((order: any) => (
                    <tr key={order.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-3">{order.orderNumber}</td>
                      <td className="py-2 px-3">{new Date(order.createdAt).toLocaleDateString()}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-1 text-xs rounded ${
                          order.status === 'PAID' ? 'bg-green-100 text-green-800' :
                          order.status === 'CANCELLED' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {order.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right">${parseFloat(order.finalAmount || order.totalAmount || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-500 py-4">{t('customers.noOrders', 'No orders yet')}</p>
          )}
        </CardContent>
      </Card>

      {/* Additional Info */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2 mt-6">
        <Card>
          <CardContent className="py-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-gray-600">{t('customers.joinDate')}</span>
              <span className="font-medium">{new Date(typedCustomer.createdAt).toLocaleDateString()}</span>
            </div>
            {typedCustomer.lastVisit && (
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-gray-600">{t('customers.lastVisit', 'Last Visit')}</span>
                <span className="font-medium">{new Date(typedCustomer.lastVisit).toLocaleDateString()}</span>
              </div>
            )}
            {typedCustomer.referralCode && (
              <div className="flex justify-between items-center text-sm mt-2">
                <span className="text-gray-600">{t('customers.referralCode', 'Referral Code')}</span>
                <span className="font-mono bg-gray-100 px-2 py-1 rounded">{typedCustomer.referralCode}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Modal */}
      <CustomerFormModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        customer={typedCustomer}
      />
    </div>
  );
};

export default CustomerDetailPage;
