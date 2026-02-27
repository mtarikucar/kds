import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Tag } from 'lucide-react';
import { usePlans, useCreatePlan, useUpdatePlan, useDeletePlan } from '../../features/superadmin/api/superAdminApi';
import { SubscriptionPlan } from '../../features/superadmin/types';

export default function PlansPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);

  const { data: plans, isLoading } = usePlans();
  const createMutation = useCreatePlan();
  const updateMutation = useUpdatePlan();
  const deleteMutation = useDeletePlan();

  const handleDelete = (id: string) => {
    if (window.confirm('Delete this plan?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleEdit = (plan: SubscriptionPlan) => {
    setEditingPlan(plan);
    setIsModalOpen(true);
  };

  const handleCreate = () => {
    setEditingPlan(null);
    setIsModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-900">Plans</h1>
          <p className="text-sm text-zinc-500 mt-1">Manage subscription plans</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Plan
        </button>
      </div>

      {/* Plans Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans?.map((plan: SubscriptionPlan) => (
          <div
            key={plan.id}
            className={`bg-white rounded-xl border border-zinc-200 p-5 ${
              !plan.isActive ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-zinc-900">{plan.displayName}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">{plan.name}</p>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleEdit(plan)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                >
                  <Pencil className="w-4 h-4 text-zinc-400" />
                </button>
                <button
                  onClick={() => handleDelete(plan.id)}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 transition-colors"
                >
                  <Trash2 className="w-4 h-4 text-zinc-400" />
                </button>
              </div>
            </div>

            {plan.isDiscountActive && plan.discountPercentage && (
              <div className="mb-3 flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700 rounded-full">
                  <Tag className="w-3 h-3" />
                  %{plan.discountPercentage} {plan.discountLabel || 'INDIRIM'}
                </span>
              </div>
            )}

            <div className="mb-4">
              {plan.isDiscountActive && plan.discountPercentage ? (
                <>
                  <p className="text-sm text-zinc-400 line-through">
                    ₺{Number(plan.monthlyPrice).toLocaleString()}/mo
                  </p>
                  <p className="text-2xl font-semibold text-emerald-600">
                    ₺{(Number(plan.monthlyPrice) * (1 - plan.discountPercentage / 100)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    <span className="text-sm font-normal text-zinc-500">/mo</span>
                  </p>
                </>
              ) : (
                <p className="text-2xl font-semibold text-zinc-900">
                  ₺{Number(plan.monthlyPrice).toLocaleString()}
                  <span className="text-sm font-normal text-zinc-500">/mo</span>
                </p>
              )}
              <p className="text-xs text-zinc-500">
                ₺{Number(plan.yearlyPrice).toLocaleString()}/year
              </p>
            </div>

            <div className="space-y-2 mb-4">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Users</span>
                <span className="text-zinc-900">{plan.maxUsers}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Tables</span>
                <span className="text-zinc-900">{plan.maxTables}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Products</span>
                <span className="text-zinc-900">{plan.maxProducts}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Orders/mo</span>
                <span className="text-zinc-900">{plan.maxMonthlyOrders}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 pt-4 border-t border-zinc-100">
              {plan.advancedReports && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Reports
                </span>
              )}
              {plan.multiLocation && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Multi-Location
                </span>
              )}
              {plan.customBranding && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Custom Branding
                </span>
              )}
              {plan.apiAccess && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  API
                </span>
              )}
              {plan.prioritySupport && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Priority
                </span>
              )}
              {plan.inventoryTracking && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Inventory
                </span>
              )}
              {plan.kdsIntegration && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  KDS
                </span>
              )}
              {plan.reservationSystem && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Reservations
                </span>
              )}
              {plan.personnelManagement && (
                <span className="px-2 py-0.5 text-xs bg-zinc-100 text-zinc-700 rounded">
                  Personnel
                </span>
              )}
            </div>

            {plan.isDiscountActive && plan.discountStartDate && plan.discountEndDate && (
              <p className="text-xs text-emerald-600 mt-3">
                {new Date(plan.discountStartDate).toLocaleDateString()} - {new Date(plan.discountEndDate).toLocaleDateString()}
              </p>
            )}

            <p className="text-xs text-zinc-400 mt-1">
              {plan._count?.subscriptions || 0} active subscriptions
            </p>
          </div>
        ))}
      </div>

      {/* Modal */}
      {isModalOpen && (
        <PlanModal
          plan={editingPlan}
          onClose={() => setIsModalOpen(false)}
          onSave={(data) => {
            if (editingPlan) {
              updateMutation.mutate({ id: editingPlan.id, ...data });
            } else {
              createMutation.mutate(data);
            }
            setIsModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

function PlanModal({
  plan,
  onClose,
  onSave,
}: {
  plan: SubscriptionPlan | null;
  onClose: () => void;
  onSave: (data: Partial<SubscriptionPlan>) => void;
}) {
  const [formData, setFormData] = useState({
    name: plan?.name || '',
    displayName: plan?.displayName || '',
    description: plan?.description || '',
    monthlyPrice: plan?.monthlyPrice || 0,
    yearlyPrice: plan?.yearlyPrice || 0,
    maxUsers: plan?.maxUsers || 1,
    maxTables: plan?.maxTables || 5,
    maxProducts: plan?.maxProducts || 50,
    maxCategories: plan?.maxCategories || 10,
    maxMonthlyOrders: plan?.maxMonthlyOrders || 100,
    advancedReports: plan?.advancedReports || false,
    multiLocation: plan?.multiLocation || false,
    customBranding: plan?.customBranding || false,
    apiAccess: plan?.apiAccess || false,
    prioritySupport: plan?.prioritySupport || false,
    inventoryTracking: plan?.inventoryTracking || false,
    kdsIntegration: plan?.kdsIntegration ?? true,
    reservationSystem: plan?.reservationSystem || false,
    personnelManagement: plan?.personnelManagement || false,
    isActive: plan?.isActive ?? true,
    discountPercentage: plan?.discountPercentage || 0,
    discountLabel: plan?.discountLabel || '',
    discountStartDate: plan?.discountStartDate ? plan.discountStartDate.slice(0, 10) : '',
    discountEndDate: plan?.discountEndDate ? plan.discountEndDate.slice(0, 10) : '',
    isDiscountActive: plan?.isDiscountActive || false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="fixed inset-0 bg-zinc-900/50" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-zinc-900">
              {plan ? 'Edit Plan' : 'Create Plan'}
            </h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-zinc-100 transition-colors">
              <X className="w-5 h-5 text-zinc-500" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Internal Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Display Name
                </label>
                <input
                  type="text"
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Monthly Price (₺)
                </label>
                <input
                  type="number"
                  value={formData.monthlyPrice}
                  onChange={(e) => setFormData({ ...formData, monthlyPrice: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1.5">
                  Yearly Price (₺)
                </label>
                <input
                  type="number"
                  value={formData.yearlyPrice}
                  onChange={(e) => setFormData({ ...formData, yearlyPrice: Number(e.target.value) })}
                  className="w-full px-3.5 py-2.5 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Max Users</label>
                <input
                  type="number"
                  value={formData.maxUsers}
                  onChange={(e) => setFormData({ ...formData, maxUsers: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Max Tables</label>
                <input
                  type="number"
                  value={formData.maxTables}
                  onChange={(e) => setFormData({ ...formData, maxTables: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Max Products</label>
                <input
                  type="number"
                  value={formData.maxProducts}
                  onChange={(e) => setFormData({ ...formData, maxProducts: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Categories</label>
                <input
                  type="number"
                  value={formData.maxCategories}
                  onChange={(e) => setFormData({ ...formData, maxCategories: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1.5">Orders/mo</label>
                <input
                  type="number"
                  value={formData.maxMonthlyOrders}
                  onChange={(e) => setFormData({ ...formData, maxMonthlyOrders: Number(e.target.value) })}
                  className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-2 pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.advancedReports}
                  onChange={(e) => setFormData({ ...formData, advancedReports: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Advanced Reports</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.multiLocation}
                  onChange={(e) => setFormData({ ...formData, multiLocation: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Multi-Location</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.customBranding}
                  onChange={(e) => setFormData({ ...formData, customBranding: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Custom Branding</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.apiAccess}
                  onChange={(e) => setFormData({ ...formData, apiAccess: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">API Access</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.prioritySupport}
                  onChange={(e) => setFormData({ ...formData, prioritySupport: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Priority Support</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.inventoryTracking}
                  onChange={(e) => setFormData({ ...formData, inventoryTracking: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Inventory Tracking</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.kdsIntegration}
                  onChange={(e) => setFormData({ ...formData, kdsIntegration: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">KDS Integration</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.reservationSystem}
                  onChange={(e) => setFormData({ ...formData, reservationSystem: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Reservations</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.personnelManagement}
                  onChange={(e) => setFormData({ ...formData, personnelManagement: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Personnel Management</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isActive}
                  onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                  className="w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                />
                <span className="text-sm text-zinc-700">Active</span>
              </label>
            </div>

            {/* Discount Settings */}
            <div className="pt-4 border-t border-zinc-200">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-zinc-900">Discount Settings</h3>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.isDiscountActive}
                    onChange={(e) => setFormData({ ...formData, isDiscountActive: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                  />
                  <span className="text-xs text-zinc-600">Active</span>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">Discount %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.discountPercentage}
                    onChange={(e) => setFormData({ ...formData, discountPercentage: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Ramazan Kampanyasi"
                    value={formData.discountLabel}
                    onChange={(e) => setFormData({ ...formData, discountLabel: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">Start Date</label>
                  <input
                    type="date"
                    value={formData.discountStartDate}
                    onChange={(e) => setFormData({ ...formData, discountStartDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1.5">End Date</label>
                  <input
                    type="date"
                    value={formData.discountEndDate}
                    onChange={(e) => setFormData({ ...formData, discountEndDate: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-700 bg-white border border-zinc-300 rounded-lg hover:bg-zinc-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
              >
                {plan ? 'Update' : 'Create'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
