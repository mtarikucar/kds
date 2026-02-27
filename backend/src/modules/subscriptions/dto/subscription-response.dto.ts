import { SubscriptionStatus, BillingCycle, PaymentProvider } from '../../../common/constants/subscription.enum';

export class SubscriptionResponseDto {
  id: string;
  tenantId: string;
  planId: string;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  paymentProvider: PaymentProvider;

  startDate: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  cancelledAt?: Date;
  endedAt?: Date;

  isTrialPeriod: boolean;
  trialStart?: Date;
  trialEnd?: Date;

  amount: number;
  currency: string;

  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;

  plan?: {
    id: string;
    name: string;
    displayName: string;
    description?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

export class PlanResponseDto {
  id: string;
  name: string;
  displayName: string;
  description?: string;

  monthlyPrice: number;
  yearlyPrice: number;
  currency: string;

  trialDays: number;

  limits: {
    maxUsers: number;
    maxTables: number;
    maxProducts: number;
    maxCategories: number;
    maxMonthlyOrders: number;
  };

  features: {
    advancedReports: boolean;
    multiLocation: boolean;
    customBranding: boolean;
    apiAccess: boolean;
    prioritySupport: boolean;
    inventoryTracking: boolean;
    kdsIntegration: boolean;
    reservationSystem: boolean;
    personnelManagement: boolean;
  };

  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class InvoiceResponseDto {
  id: string;
  subscriptionId: string;
  invoiceNumber: string;
  status: string;

  subtotal: number;
  tax: number;
  total: number;
  currency: string;

  periodStart: Date;
  periodEnd: Date;

  dueDate?: Date;
  paidAt?: Date;

  description?: string;
  pdfUrl?: string;

  createdAt: Date;
  updatedAt: Date;
}
