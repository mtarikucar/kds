import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CreditCard,
  Calendar,
  AlertCircle,
  CheckCircle,
  Download,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import {
  useGetCurrentSubscription,
  useGetPlans,
  useGetTenantInvoices,
  useCancelSubscription,
  useReactivateSubscription,
  useChangePlan,
} from '../../features/subscriptions/subscriptionsApi';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import Spinner from '../../components/ui/Spinner';
import Badge from '../../components/ui/Badge';
import Modal from '../../components/ui/Modal';
import {
  SubscriptionStatus,
  BillingCycle,
  InvoiceStatus,
  SubscriptionPlanType,
} from '../../types';

const SubscriptionManagementPage = () => {
  const navigate = useNavigate();
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showChangePlanModal, setShowChangePlanModal] = useState(false);
  const [selectedNewPlanId, setSelectedNewPlanId] = useState<string | null>(null);
  const [cancellationReason, setCancellationReason] = useState<string>('');

  const { data: currentSubscription, isLoading: subLoading } = useGetCurrentSubscription();
  const { data: plans } = useGetPlans();
  const { data: invoices, isLoading: invoicesLoading } = useGetTenantInvoices();
  const cancelSubscription = useCancelSubscription();
  const reactivateSubscription = useReactivateSubscription();
  const changePlan = useChangePlan();

  if (subLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!currentSubscription) {
    return (
      <div className="max-w-2xl mx-auto text-center py-12">
        <AlertCircle className="h-16 w-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-2xl font-bold text-gray-900 mb-2">No Active Subscription</h2>
        <p className="text-gray-600 mb-6">
          You don't have an active subscription. Choose a plan to get started.
        </p>
        <Button variant="primary" onClick={() => navigate('/subscription/plans')}>
          View Plans
        </Button>
      </div>
    );
  }

  const getStatusBadge = (status: SubscriptionStatus) => {
    const statusConfig = {
      [SubscriptionStatus.ACTIVE]: { variant: 'success' as const, label: 'Active' },
      [SubscriptionStatus.TRIALING]: { variant: 'info' as const, label: 'Trial' },
      [SubscriptionStatus.CANCELLED]: { variant: 'warning' as const, label: 'Cancelled' },
      [SubscriptionStatus.EXPIRED]: { variant: 'danger' as const, label: 'Expired' },
      [SubscriptionStatus.PAST_DUE]: { variant: 'danger' as const, label: 'Past Due' },
    };

    const config = statusConfig[status] || { variant: 'default' as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const getInvoiceStatusBadge = (status: InvoiceStatus) => {
    const statusConfig = {
      [InvoiceStatus.PAID]: { variant: 'success' as const, label: 'Paid' },
      [InvoiceStatus.OPEN]: { variant: 'warning' as const, label: 'Open' },
      [InvoiceStatus.DRAFT]: { variant: 'default' as const, label: 'Draft' },
      [InvoiceStatus.VOID]: { variant: 'danger' as const, label: 'Void' },
      [InvoiceStatus.UNCOLLECTIBLE]: { variant: 'danger' as const, label: 'Uncollectible' },
    };

    const config = statusConfig[status] || { variant: 'default' as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const handleCancelSubscription = async () => {
    if (!currentSubscription) return;
    try {
      await cancelSubscription.mutateAsync({
        id: currentSubscription.id,
        immediate: false,
        reason: cancellationReason || undefined,
      });
      setShowCancelModal(false);
      setCancellationReason('');
    } catch (error) {
      console.error('Failed to cancel subscription:', error);
    }
  };

  const handleReactivate = async () => {
    if (!currentSubscription) return;
    try {
      await reactivateSubscription.mutateAsync(currentSubscription.id);
    } catch (error) {
      console.error('Failed to reactivate subscription:', error);
    }
  };

  const handleChangePlan = async () => {
    if (!currentSubscription || !selectedNewPlanId) return;
    try {
      await changePlan.mutateAsync({
        id: currentSubscription.id,
        data: {
          newPlanId: selectedNewPlanId,
          billingCycle: currentSubscription.billingCycle,
        },
      });
      setShowChangePlanModal(false);
      setSelectedNewPlanId(null);
    } catch (error) {
      console.error('Failed to change plan:', error);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const currentPlan = plans?.find((p) => p.id === currentSubscription.planId);
  const availablePlans = plans?.filter((p) => p.id !== currentSubscription.planId) || [];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">Subscription Management</h1>
        <Button variant="outline" onClick={() => navigate('/subscription/plans')}>
          View All Plans
        </Button>
      </div>

      {/* Current Subscription Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current Subscription</CardTitle>
            {getStatusBadge(currentSubscription.status)}
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {currentSubscription.plan?.displayName || 'Unknown Plan'}
              </h3>
              <div className="space-y-3">
                <div className="flex items-center text-sm">
                  <CreditCard className="h-4 w-4 text-gray-400 mr-2" />
                  <span className="text-gray-600">
                    ${Number(currentSubscription.amount).toFixed(2)} /{' '}
                    {currentSubscription.billingCycle === BillingCycle.MONTHLY
                      ? 'month'
                      : 'year'}
                  </span>
                </div>
                <div className="flex items-center text-sm">
                  <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                  <span className="text-gray-600">
                    Next billing: {formatDate(currentSubscription.currentPeriodEnd)}
                  </span>
                </div>
                {currentSubscription.isTrialPeriod && currentSubscription.trialEnd && (
                  <div className="flex items-center text-sm">
                    <CheckCircle className="h-4 w-4 text-blue-500 mr-2" />
                    <span className="text-blue-600">
                      Trial ends: {formatDate(currentSubscription.trialEnd)}
                    </span>
                  </div>
                )}
                {currentSubscription.cancelAtPeriodEnd && (
                  <div className="flex items-center text-sm">
                    <AlertCircle className="h-4 w-4 text-orange-500 mr-2" />
                    <span className="text-orange-600">
                      Cancels on: {formatDate(currentSubscription.currentPeriodEnd)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-3">
              {(currentSubscription.status === SubscriptionStatus.ACTIVE ||
                currentSubscription.status === SubscriptionStatus.TRIALING) && (
                <>
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => setShowChangePlanModal(true)}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Change Plan
                  </Button>
                  {!currentSubscription.cancelAtPeriodEnd && (
                    <Button
                      variant="danger"
                      className="w-full"
                      onClick={() => setShowCancelModal(true)}
                    >
                      <XCircle className="h-4 w-4 mr-2" />
                      Cancel Subscription
                    </Button>
                  )}
                </>
              )}
              {currentSubscription.cancelAtPeriodEnd && (
                <Button
                  variant="success"
                  className="w-full"
                  onClick={handleReactivate}
                  isLoading={reactivateSubscription.isPending}
                >
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Reactivate Subscription
                </Button>
              )}
            </div>
          </div>

          {/* Plan Features */}
          {currentPlan && (
            <div className="mt-6 pt-6 border-t">
              <h4 className="font-semibold text-gray-900 mb-3">Plan Limits & Features</h4>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-gray-500">Users</p>
                  <p className="font-semibold">
                    {currentPlan.limits.maxUsers === -1
                      ? 'Unlimited'
                      : currentPlan.limits.maxUsers}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Tables</p>
                  <p className="font-semibold">
                    {currentPlan.limits.maxTables === -1
                      ? 'Unlimited'
                      : currentPlan.limits.maxTables}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Products</p>
                  <p className="font-semibold">
                    {currentPlan.limits.maxProducts === -1
                      ? 'Unlimited'
                      : currentPlan.limits.maxProducts}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Monthly Orders</p>
                  <p className="font-semibold">
                    {currentPlan.limits.maxMonthlyOrders === -1
                      ? 'Unlimited'
                      : currentPlan.limits.maxMonthlyOrders}
                  </p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing History */}
      <Card>
        <CardHeader>
          <CardTitle>Billing History</CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : !invoices || invoices.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No invoices yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Invoice
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Amount
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                        {invoice.invoiceNumber}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {formatDate(invoice.createdAt)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        ${Number(invoice.total).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getInvoiceStatusBadge(invoice.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {invoice.pdfUrl && (
                          <a
                            href={invoice.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 inline-flex items-center"
                          >
                            <Download className="h-4 w-4 mr-1" />
                            Download
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cancel Subscription Modal */}
      <Modal
        isOpen={showCancelModal}
        onClose={() => {
          setShowCancelModal(false);
          setCancellationReason('');
        }}
        title="Cancel Subscription"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            Are you sure you want to cancel your subscription? You'll continue to have access until
            the end of your current billing period on{' '}
            <strong>{formatDate(currentSubscription.currentPeriodEnd)}</strong>.
          </p>

          <div>
            <label htmlFor="cancellation-reason" className="block text-sm font-medium text-gray-700 mb-2">
              Help us improve - Why are you cancelling? (Optional)
            </label>
            <select
              id="cancellation-reason"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a reason...</option>
              <option value="Too expensive">Too expensive</option>
              <option value="Missing features I need">Missing features I need</option>
              <option value="Switching to competitor">Switching to competitor</option>
              <option value="No longer needed">No longer needed</option>
              <option value="Poor customer support">Poor customer support</option>
              <option value="Technical issues">Technical issues</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setShowCancelModal(false);
                setCancellationReason('');
              }}
            >
              Keep Subscription
            </Button>
            <Button
              variant="danger"
              onClick={handleCancelSubscription}
              isLoading={cancelSubscription.isPending}
            >
              Cancel Subscription
            </Button>
          </div>
        </div>
      </Modal>

      {/* Change Plan Modal */}
      <Modal
        isOpen={showChangePlanModal}
        onClose={() => {
          setShowChangePlanModal(false);
          setSelectedNewPlanId(null);
        }}
        title="Change Plan"
      >
        <div className="space-y-4">
          <p className="text-gray-600">Select a new plan:</p>
          <div className="space-y-2">
            {availablePlans.map((plan) => (
              <div
                key={plan.id}
                onClick={() => setSelectedNewPlanId(plan.id)}
                className={`p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedNewPlanId === plan.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-gray-900">{plan.displayName}</h4>
                    <p className="text-sm text-gray-600">{plan.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-gray-900">
                      $
                      {currentSubscription.billingCycle === BillingCycle.MONTHLY
                        ? Number(plan.monthlyPrice).toFixed(2)
                        : Number(plan.yearlyPrice).toFixed(2)}
                    </p>
                    <p className="text-xs text-gray-500">
                      /{currentSubscription.billingCycle === BillingCycle.MONTHLY ? 'mo' : 'yr'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowChangePlanModal(false);
                setSelectedNewPlanId(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleChangePlan}
              disabled={!selectedNewPlanId}
              isLoading={changePlan.isPending}
            >
              Change Plan
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default SubscriptionManagementPage;
