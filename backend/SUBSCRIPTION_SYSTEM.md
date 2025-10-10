# Subscription System Documentation

## Overview

A complete dual-payment provider subscription system with support for both Stripe (international) and Iyzico (Turkey). The system includes trial periods, plan-based access control, auto-renewal, and comprehensive billing management.

## Features

✅ **Dual Payment Providers**: Stripe for international users, Iyzico for Turkish users
✅ **4 Subscription Tiers**: FREE, BASIC, PRO, BUSINESS
✅ **Trial Periods**: One-time 14-day trials for paid plans
✅ **Flexible Billing**: Monthly or yearly billing cycles
✅ **Plan Management**: Upgrade, downgrade, or cancel anytime
✅ **Access Control**: Plan-based guards and feature flags
✅ **Auto-Renewal**: Automatic subscription renewals with retry logic
✅ **Usage Limits**: Enforce limits on users, tables, products, etc.
✅ **Billing & Invoices**: Automatic invoice generation
✅ **Webhooks**: Handle payment provider callbacks
✅ **Scheduled Tasks**: Automated trial expiration, renewals, and reminders

## Setup Instructions

### 1. Database Migration

Run the Prisma migration to create subscription tables:

\`\`\`bash
cd backend
npx prisma migrate dev --name add_subscription_system
npx prisma generate
\`\`\`

### 2. Environment Variables

Add the following to your `.env` file:

\`\`\`env
# Stripe (International Payments)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_test_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Iyzico (Turkey Payments)
IYZICO_API_KEY=your_iyzico_api_key
IYZICO_SECRET_KEY=your_iyzico_secret_key
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com

# Subscription Settings
DEFAULT_TRIAL_DAYS=14
TRIAL_REMINDER_DAYS=3
\`\`\`

### 3. Seed Subscription Plans

Create a seed script to populate subscription plans:

\`\`\`typescript
// prisma/seed-subscriptions.ts
import { PrismaClient } from '@prisma/client';
import { SUBSCRIPTION_PLANS } from '../src/common/constants/subscription-plans.const';

const prisma = new PrismaClient();

async function seedSubscriptionPlans() {
  for (const [key, config] of Object.entries(SUBSCRIPTION_PLANS)) {
    await prisma.subscriptionPlan.upsert({
      where: { name: config.name },
      update: {
        displayName: config.displayName,
        description: config.description,
        monthlyPrice: config.monthlyPrice,
        yearlyPrice: config.yearlyPrice,
        currency: config.currency,
        trialDays: config.trialDays,
        maxUsers: config.limits.maxUsers,
        maxTables: config.limits.maxTables,
        maxProducts: config.limits.maxProducts,
        maxCategories: config.limits.maxCategories,
        maxMonthlyOrders: config.limits.maxMonthlyOrders,
        advancedReports: config.features.advancedReports,
        multiLocation: config.features.multiLocation,
        customBranding: config.features.customBranding,
        apiAccess: config.features.apiAccess,
        prioritySupport: config.features.prioritySupport,
        inventoryTracking: config.features.inventoryTracking,
        kdsIntegration: config.features.kdsIntegration,
        isActive: true,
      },
      create: {
        name: config.name,
        displayName: config.displayName,
        description: config.description,
        monthlyPrice: config.monthlyPrice,
        yearlyPrice: config.yearlyPrice,
        currency: config.currency,
        trialDays: config.trialDays,
        maxUsers: config.limits.maxUsers,
        maxTables: config.limits.maxTables,
        maxProducts: config.limits.maxProducts,
        maxCategories: config.limits.maxCategories,
        maxMonthlyOrders: config.limits.maxMonthlyOrders,
        advancedReports: config.features.advancedReports,
        multiLocation: config.features.multiLocation,
        customBranding: config.features.customBranding,
        apiAccess: config.features.apiAccess,
        prioritySupport: config.features.prioritySupport,
        inventoryTracking: config.features.inventoryTracking,
        kdsIntegration: config.features.kdsIntegration,
        isActive: true,
      },
    });
  }
}

seedSubscriptionPlans()
  .then(() => console.log('Subscription plans seeded'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
\`\`\`

Run the seed:
\`\`\`bash
npx ts-node prisma/seed-subscriptions.ts
\`\`\`

### 4. Configure Webhooks

#### Stripe Webhooks
1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://yourdomain.com/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `customer.subscription.*`, `invoice.*`
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

#### Iyzico Callbacks
1. Configure callback URL in Iyzico dashboard: `https://yourdomain.com/webhooks/iyzico`

## API Endpoints

### Subscription Management

\`\`\`
GET    /subscriptions/plans           - List all available plans
GET    /subscriptions/current         - Get current tenant subscription
GET    /subscriptions/:id             - Get subscription by ID
POST   /subscriptions                 - Create new subscription
PATCH  /subscriptions/:id             - Update subscription settings
POST   /subscriptions/:id/change-plan - Upgrade/downgrade plan
POST   /subscriptions/:id/cancel      - Cancel subscription
POST   /subscriptions/:id/reactivate  - Reactivate cancelled subscription
GET    /subscriptions/:id/invoices    - Get subscription invoices
GET    /subscriptions/tenant/invoices - Get all tenant invoices
\`\`\`

### Payment Processing

\`\`\`
POST   /payments/create-intent        - Create payment intent
POST   /payments/confirm-payment      - Confirm payment with card details
POST   /payments/history              - Get payment history
\`\`\`

### Webhooks

\`\`\`
POST   /webhooks/stripe               - Stripe webhook handler
POST   /webhooks/iyzico               - Iyzico callback handler
\`\`\`

## Using Access Control

### 1. Require Active Subscription

\`\`\`typescript
import { UseGuards } from '@nestjs/common';
import { SubscriptionGuard } from './modules/subscriptions/guards/subscription.guard';
import { RequiresActiveSubscription } from './modules/subscriptions/decorators/requires-active-subscription.decorator';

@Controller('advanced-features')
@UseGuards(SubscriptionGuard)
@RequiresActiveSubscription()
export class AdvancedFeaturesController {
  // Routes here require active subscription
}
\`\`\`

### 2. Require Specific Plans

\`\`\`typescript
import { UseGuards } from '@nestjs/common';
import { PlanFeatureGuard } from './modules/subscriptions/guards/plan-feature.guard';
import { RequiresPlan } from './modules/subscriptions/decorators/requires-plan.decorator';
import { SubscriptionPlanType } from './common/constants/subscription.enum';

@Controller('analytics')
@UseGuards(PlanFeatureGuard)
export class AnalyticsController {
  @Get('advanced-reports')
  @RequiresPlan(SubscriptionPlanType.PRO, SubscriptionPlanType.BUSINESS)
  getAdvancedReports() {
    // Only PRO and BUSINESS plans can access
  }
}
\`\`\`

### 3. Require Specific Features

\`\`\`typescript
import { RequiresFeature } from './modules/subscriptions/decorators/requires-feature.decorator';
import { PlanFeature } from './common/constants/subscription.enum';

@Controller('locations')
@UseGuards(PlanFeatureGuard)
export class LocationsController {
  @Post()
  @RequiresFeature(PlanFeature.MULTI_LOCATION)
  createLocation() {
    // Only plans with multiLocation feature can access
  }
}
\`\`\`

### 4. Check Usage Limits

\`\`\`typescript
import { CheckLimit, LimitType } from './modules/subscriptions/decorators/check-limit.decorator';

@Controller('users')
@UseGuards(PlanFeatureGuard)
export class UsersController {
  @Post()
  @CheckLimit(LimitType.USERS)
  createUser() {
    // Checks if user limit has been reached before creating
  }
}
\`\`\`

## Subscription Flow

### For International Users (Stripe)

1. User selects plan and billing cycle
2. Frontend calls `POST /payments/create-intent` → gets `clientSecret`
3. Frontend uses Stripe.js to collect card and confirm payment
4. Backend receives webhook → updates subscription status
5. User gains access to plan features

### For Turkish Users (Iyzico)

1. User selects plan and billing cycle
2. Frontend calls `POST /payments/create-intent` → gets amount info
3. Frontend collects card details (Iyzico format)
4. Frontend calls `POST /payments/confirm-payment` with card details
5. Backend processes payment with Iyzico → creates subscription
6. User gains access to plan features

## Scheduled Tasks

The system runs the following automated tasks:

- **Daily 12:00 AM**: Expire trials that have ended
- **Daily 2:00 AM**: Process subscription renewals
- **Daily 12:00 AM**: Cancel subscriptions scheduled for cancellation
- **Daily 3:00 AM**: Mark past-due subscriptions as expired (7 days grace)
- **Daily 10:00 AM**: Send trial ending reminders (3 days before)

## Subscription Plans

| Plan     | Monthly | Yearly   | Users | Tables | Products | Features                          |
|----------|---------|----------|-------|--------|----------|-----------------------------------|
| FREE     | $0      | $0       | 2     | 5      | 25       | Basic KDS                         |
| BASIC    | $29.99  | $299.99  | 5     | 20     | 100      | + Inventory Tracking              |
| PRO      | $79.99  | $799.99  | 15    | 50     | 500      | + Multi-location, Reports, Branding|
| BUSINESS | $199.99 | $1999.99 | ∞     | ∞      | ∞        | + API Access, Priority Support    |

## Testing

### Test Stripe Integration
Use Stripe test cards:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`

### Test Iyzico Integration
Use Iyzico sandbox credentials and test cards from their documentation.

## Common Operations

### Create a Subscription
\`\`\`typescript
POST /subscriptions
{
  "planId": "uuid-of-plan",
  "billingCycle": "MONTHLY",
  "paymentMethodId": "pm_xxx" // For Stripe
}
\`\`\`

### Upgrade Plan
\`\`\`typescript
POST /subscriptions/:id/change-plan
{
  "newPlanId": "uuid-of-new-plan",
  "billingCycle": "YEARLY",
  "paymentMethodId": "pm_xxx" // If upgrade requires payment
}
\`\`\`

### Cancel Subscription
\`\`\`typescript
POST /subscriptions/:id/cancel
{
  "immediate": false // Cancel at period end
}
\`\`\`

## Troubleshooting

### Subscription not activating
- Check webhook configuration
- Verify payment was successful
- Check subscription status in database

### Access denied errors
- Verify tenant has active subscription
- Check plan includes required feature
- Verify usage limit not exceeded

### Payment failures
- Check API keys are correct
- Verify webhook signatures
- Review payment provider logs

## Support

For issues or questions:
1. Check this documentation
2. Review backend logs for errors
3. Verify environment variables are set correctly
4. Test with payment provider sandboxes first
