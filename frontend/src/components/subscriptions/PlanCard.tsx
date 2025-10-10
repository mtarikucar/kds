import { Check, X } from 'lucide-react';
import { Plan, BillingCycle, SubscriptionPlanType } from '../../types';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';

interface PlanCardProps {
  plan: Plan;
  billingCycle: BillingCycle;
  isCurrentPlan?: boolean;
  isPopular?: boolean;
  onSelectPlan: (planId: string) => void;
  isLoading?: boolean;
}

const PlanCard = ({
  plan,
  billingCycle,
  isCurrentPlan = false,
  isPopular = false,
  onSelectPlan,
  isLoading = false,
}: PlanCardProps) => {
  // Convert price to number in case it comes as Decimal/string from backend
  const price = Number(billingCycle === BillingCycle.MONTHLY ? plan.monthlyPrice : plan.yearlyPrice);
  const pricePerMonth = billingCycle === BillingCycle.YEARLY ? price / 12 : price;

  const isUnlimited = (limit: number) => limit === -1;
  const formatLimit = (limit: number) => (isUnlimited(limit) ? 'Unlimited' : limit);

  const planColors = {
    [SubscriptionPlanType.FREE]: 'border-gray-300',
    [SubscriptionPlanType.BASIC]: 'border-blue-300',
    [SubscriptionPlanType.PRO]: 'border-purple-500',
    [SubscriptionPlanType.BUSINESS]: 'border-yellow-500',
  };

  return (
    <div
      className={cn(
        'relative bg-white rounded-xl border-2 shadow-lg p-6 flex flex-col',
        isPopular ? 'border-blue-500 ring-2 ring-blue-500 ring-offset-2' : planColors[plan.name],
        isCurrentPlan && 'bg-blue-50'
      )}
    >
      {isPopular && (
        <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
          <span className="bg-blue-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
            Most Popular
          </span>
        </div>
      )}

      {isCurrentPlan && (
        <div className="absolute -top-4 right-4">
          <span className="bg-green-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
            Current Plan
          </span>
        </div>
      )}

      <div className="mb-6">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.displayName}</h3>
        <p className="text-gray-600 text-sm min-h-[40px]">{plan.description}</p>
      </div>

      <div className="mb-6">
        <div className="flex items-baseline">
          <span className="text-4xl font-bold text-gray-900">${price.toFixed(2)}</span>
          <span className="text-gray-600 ml-2">
            /{billingCycle === BillingCycle.MONTHLY ? 'month' : 'year'}
          </span>
        </div>
        {billingCycle === BillingCycle.YEARLY && price > 0 && (
          <p className="text-sm text-green-600 mt-1">
            ${pricePerMonth.toFixed(2)}/month - Save{' '}
            {Math.round(((Number(plan.monthlyPrice) * 12 - price) / (Number(plan.monthlyPrice) * 12)) * 100)}%
          </p>
        )}
        {plan.trialDays > 0 && (
          <p className="text-sm text-blue-600 mt-1">{plan.trialDays}-day free trial</p>
        )}
      </div>

      <div className="mb-6 flex-grow">
        <h4 className="font-semibold text-gray-900 mb-3">Usage Limits:</h4>
        <ul className="space-y-2 mb-4">
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxUsers)} User{isUnlimited(plan.limits.maxUsers) || plan.limits.maxUsers > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxTables)} Table{isUnlimited(plan.limits.maxTables) || plan.limits.maxTables > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxProducts)} Product{isUnlimited(plan.limits.maxProducts) || plan.limits.maxProducts > 1 ? 's' : ''}
            </span>
          </li>
          <li className="flex items-center text-sm text-gray-700">
            <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
            <span>
              {formatLimit(plan.limits.maxMonthlyOrders)} Order{isUnlimited(plan.limits.maxMonthlyOrders) || plan.limits.maxMonthlyOrders > 1 ? 's' : ''}/month
            </span>
          </li>
        </ul>

        <h4 className="font-semibold text-gray-900 mb-3">Features:</h4>
        <ul className="space-y-2">
          {Object.entries(plan.features).map(([key, value]) => {
            const featureLabels: Record<string, string> = {
              advancedReports: 'Advanced Reports',
              multiLocation: 'Multi-Location Support',
              customBranding: 'Custom Branding',
              apiAccess: 'API Access',
              prioritySupport: 'Priority Support',
              inventoryTracking: 'Inventory Tracking',
              kdsIntegration: 'Kitchen Display System',
            };

            return (
              <li key={key} className="flex items-center text-sm text-gray-700">
                {value ? (
                  <>
                    <Check className="h-4 w-4 text-green-500 mr-2 flex-shrink-0" />
                    <span>{featureLabels[key]}</span>
                  </>
                ) : (
                  <>
                    <X className="h-4 w-4 text-gray-400 mr-2 flex-shrink-0" />
                    <span className="text-gray-400">{featureLabels[key]}</span>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <Button
        variant={isPopular ? 'primary' : 'outline'}
        className="w-full"
        onClick={() => onSelectPlan(plan.id)}
        disabled={isCurrentPlan || isLoading}
        isLoading={isLoading}
      >
        {isCurrentPlan ? 'Current Plan' : 'Select Plan'}
      </Button>
    </div>
  );
};

export default PlanCard;
