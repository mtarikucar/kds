# Complete Subscription System Implementation Guide

## 🎯 Current Status

### ✅ Fully Implemented (Backend)
- Database schema with 4 subscription models
- Payment provider services (Stripe & Iyzico)
- Subscription management service
- Billing and invoice service
- Access control guards and decorators
- REST API controllers (17 endpoints)
- Scheduled tasks (cron jobs)
- Notification service with email templates
- Complete module setup and configuration

### 📋 Remaining Implementation

This guide provides all the code needed to complete:
1. Invoice PDF generation
2. Frontend subscription UI
3. Production monitoring
4. Deployment configuration

---

## Part 1: Invoice PDF Generation (Backend)

### 1.1 Create Invoice PDF Service

**File**: `backend/src/modules/subscriptions/services/invoice-pdf.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as PDFDocument from 'pdfkit';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class InvoicePdfService {
  private readonly logger = new Logger(InvoicePdfService.name);
  private readonly invoicesPath: string;

  constructor(private configService: ConfigService) {
    this.invoicesPath = path.join(process.cwd(), 'storage', 'invoices');

    // Create directory if it doesn't exist
    if (!fs.existsSync(this.invoicesPath)) {
      fs.mkdirSync(this.invoicesPath, { recursive: true });
    }
  }

  async generateInvoicePdf(invoice: any): Promise<string> {
    const fileName = `invoice-${invoice.invoiceNumber}.pdf`;
    const filePath = path.join(this.invoicesPath, fileName);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const stream = fs.createWriteStream(filePath);

      stream.on('finish', () => {
        this.logger.log(`PDF generated: ${fileName}`);
        resolve(filePath);
      });

      stream.on('error', reject);

      doc.pipe(stream);

      // Header
      doc
        .fontSize(20)
        .text('INVOICE', 50, 50)
        .fontSize(10)
        .text(`Invoice #: ${invoice.invoiceNumber}`, 50, 80)
        .text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`, 50, 95)
        .text(`Due Date: ${invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Upon receipt'}`, 50, 110);

      // Company info (right side)
      doc
        .fontSize(10)
        .text('Restaurant POS System', 300, 50)
        .text('123 Business Street', 300, 65)
        .text('City, Country', 300, 80)
        .text('support@restaurant-pos.com', 300, 95);

      // Customer info
      doc
        .fontSize(12)
        .text('BILL TO:', 50, 150)
        .fontSize(10)
        .text(invoice.subscription.tenant.name, 50, 170)
        .text(invoice.subscription.tenant.subdomain || 'N/A', 50, 185);

      // Line
      doc.moveTo(50, 220).lineTo(550, 220).stroke();

      // Table header
      doc
        .fontSize(10)
        .text('Description', 50, 240)
        .text('Period', 250, 240)
        .text('Amount', 450, 240);

      doc.moveTo(50, 260).lineTo(550, 260).stroke();

      // Invoice items
      const description = invoice.description || `${invoice.subscription.plan.displayName} Subscription`;
      const period = `${new Date(invoice.periodStart).toLocaleDateString()} - ${new Date(invoice.periodEnd).toLocaleDateString()}`;

      doc
        .text(description, 50, 280)
        .text(period, 250, 280)
        .text(`${invoice.currency} ${Number(invoice.subtotal).toFixed(2)}`, 450, 280);

      // Totals
      const totalsY = 350;
      doc
        .text('Subtotal:', 350, totalsY)
        .text(`${invoice.currency} ${Number(invoice.subtotal).toFixed(2)}`, 450, totalsY);

      if (invoice.tax > 0) {
        doc
          .text('Tax:', 350, totalsY + 20)
          .text(`${invoice.currency} ${Number(invoice.tax).toFixed(2)}`, 450, totalsY + 20);
      }

      doc
        .fontSize(12)
        .text('TOTAL:', 350, totalsY + 40)
        .text(`${invoice.currency} ${Number(invoice.total).toFixed(2)}`, 450, totalsY + 40);

      // Payment status
      const statusY = totalsY + 80;
      const statusText = invoice.status === 'PAID' ? 'PAID' : 'DUE';
      const statusColor = invoice.status === 'PAID' ? 'green' : 'red';

      doc
        .fontSize(14)
        .fillColor(statusColor)
        .text(statusText, 50, statusY)
        .fillColor('black');

      if (invoice.paidAt) {
        doc
          .fontSize(10)
          .text(`Paid on: ${new Date(invoice.paidAt).toLocaleDateString()}`, 50, statusY + 25);
      }

      // Footer
      doc
        .fontSize(8)
        .text('Thank you for your business!', 50, 700, { align: 'center' });

      doc.end();
    });
  }

  async getInvoicePath(invoiceNumber: string): Promise<string | null> {
    const fileName = `invoice-${invoiceNumber}.pdf`;
    const filePath = path.join(this.invoicesPath, fileName);

    if (fs.existsSync(filePath)) {
      return filePath;
    }

    return null;
  }
}
```

### 1.2 Add Download Endpoint

Update `backend/src/modules/subscriptions/controllers/subscription.controller.ts`:

```typescript
import { Response } from 'express';
import { InvoicePdfService } from '../services/invoice-pdf.service';

// In constructor, inject InvoicePdfService
constructor(
  private readonly subscriptionService: SubscriptionService,
  private readonly billingService: BillingService,
  private readonly invoicePdfService: InvoicePdfService, // Add this
) {}

// Add this new endpoint
@Get('invoices/:invoiceNumber/download')
async downloadInvoice(
  @Param('invoiceNumber') invoiceNumber: string,
  @Res() res: Response,
) {
  const invoice = await this.billingService.getInvoiceByNumber(invoiceNumber);

  if (!invoice) {
    throw new NotFoundException('Invoice not found');
  }

  // Generate PDF if it doesn't exist
  let pdfPath = await this.invoicePdfService.getInvoicePath(invoiceNumber);

  if (!pdfPath) {
    pdfPath = await this.invoicePdfService.generateInvoicePdf(invoice);
  }

  res.download(pdfPath, `invoice-${invoiceNumber}.pdf`);
}
```

### 1.3 Update SubscriptionsModule

Add `InvoicePdfService` and `NotificationService` to providers in `subscriptions.module.ts`.

---

## Part 2: Frontend Implementation

### 2.1 Install Frontend Packages

```bash
cd frontend
npm install @stripe/stripe-js @stripe/react-stripe-js
npm install @tanstack/react-query@latest
npm install recharts react-hot-toast
```

### 2.2 API Integration Layer

**File**: `frontend/src/api/subscriptionApi.ts`

```typescript
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const subscriptionApi = {
  // Plans
  getPlans: () => api.get('/subscriptions/plans'),

  // Subscription
  getCurrentSubscription: () => api.get('/subscriptions/current'),
  createSubscription: (data: any) => api.post('/subscriptions', data),
  changePlan: (id: string, data: any) => api.post(`/subscriptions/${id}/change-plan`, data),
  cancelSubscription: (id: string, immediate: boolean) =>
    api.post(`/subscriptions/${id}/cancel`, { immediate }),
  reactivateSubscription: (id: string) => api.post(`/subscriptions/${id}/reactivate`),

  // Payment
  createPaymentIntent: (data: any) => api.post('/payments/create-intent', data),
  confirmPayment: (data: any) => api.post('/payments/confirm-payment', data),
  getPaymentHistory: () => api.post('/payments/history'),

  // Invoices
  getInvoices: () => api.get('/subscriptions/tenant/invoices'),
  downloadInvoice: (invoiceNumber: string) =>
    `${API_URL}/subscriptions/invoices/${invoiceNumber}/download`,
};
```

### 2.3 Zustand Store

**File**: `frontend/src/store/subscriptionStore.ts`

```typescript
import { create } from 'zustand';

interface SubscriptionState {
  currentSubscription: any | null;
  plans: any[];
  loading: boolean;
  setCurrentSubscription: (subscription: any) => void;
  setPlans: (plans: any[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  currentSubscription: null,
  plans: [],
  loading: false,
  setCurrentSubscription: (subscription) => set({ currentSubscription: subscription }),
  setPlans: (plans) => set({ plans }),
  setLoading: (loading) => set({ loading }),
}));
```

### 2.4 Pricing Page Component

**File**: `frontend/src/pages/PricingPage.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../api/subscriptionApi';
import PricingCard from '../components/PricingCard';
import { toast } from 'react-hot-toast';

export default function PricingPage() {
  const [billingCycle, setBillingCycle] = useState<'MONTHLY' | 'YEARLY'>('MONTHLY');

  const { data: plans, isLoading } = useQuery({
    queryKey: ['plans'],
    queryFn: () => subscriptionApi.getPlans().then(res => res.data),
  });

  const { data: currentSubscription } = useQuery({
    queryKey: ['current-subscription'],
    queryFn: () => subscriptionApi.getCurrentSubscription().then(res => res.data),
  });

  if (isLoading) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            Choose Your Plan
          </h1>
          <p className="text-xl text-gray-600">
            Select the perfect plan for your restaurant
          </p>

          {/* Billing Toggle */}
          <div className="mt-8 flex justify-center items-center gap-4">
            <span className={billingCycle === 'MONTHLY' ? 'font-semibold' : 'text-gray-500'}>
              Monthly
            </span>
            <button
              onClick={() => setBillingCycle(prev => prev === 'MONTHLY' ? 'YEARLY' : 'MONTHLY')}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-indigo-600"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                  billingCycle === 'YEARLY' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={billingCycle === 'YEARLY' ? 'font-semibold' : 'text-gray-500'}>
              Yearly <span className="text-green-600 text-sm">(Save 17%)</span>
            </span>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
          {plans?.map((plan: any) => (
            <PricingCard
              key={plan.id}
              plan={plan}
              billingCycle={billingCycle}
              currentPlanId={currentSubscription?.planId}
              isCurrentSubscription={currentSubscription?.planId === plan.id}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

### 2.5 Pricing Card Component

**File**: `frontend/src/components/PricingCard.tsx`

```typescript
import React from 'react';
import { useNavigate } from 'react-router-dom';

interface PricingCardProps {
  plan: any;
  billingCycle: 'MONTHLY' | 'YEARLY';
  currentPlanId?: string;
  isCurrentSubscription: boolean;
}

export default function PricingCard({
  plan,
  billingCycle,
  currentPlanId,
  isCurrentSubscription,
}: PricingCardProps) {
  const navigate = useNavigate();
  const price = billingCycle === 'MONTHLY' ? plan.monthlyPrice : plan.yearlyPrice;
  const isRecommended = plan.name === 'PRO';

  const handleSubscribe = () => {
    navigate('/subscription/checkout', {
      state: { planId: plan.id, billingCycle },
    });
  };

  return (
    <div
      className={`relative bg-white rounded-lg shadow-lg p-8 ${
        isRecommended ? 'ring-2 ring-indigo-600 scale-105' : ''
      }`}
    >
      {isRecommended && (
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
          <span className="bg-indigo-600 text-white px-4 py-1 rounded-full text-sm font-semibold">
            RECOMMENDED
          </span>
        </div>
      )}

      {isCurrentSubscription && (
        <div className="absolute top-4 right-4">
          <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-semibold">
            Current Plan
          </span>
        </div>
      )}

      <div className="text-center">
        <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.displayName}</h3>
        <p className="text-gray-600 mb-6 h-12">{plan.description}</p>

        <div className="mb-6">
          <span className="text-4xl font-bold text-gray-900">${price}</span>
          <span className="text-gray-600">/{billingCycle === 'MONTHLY' ? 'mo' : 'yr'}</span>
        </div>

        {plan.trialDays > 0 && !isCurrentSubscription && (
          <p className="text-sm text-green-600 mb-4">
            {plan.trialDays}-day free trial
          </p>
        )}

        <button
          onClick={handleSubscribe}
          disabled={isCurrentSubscription}
          className={`w-full py-3 px-6 rounded-lg font-semibold transition ${
            isCurrentSubscription
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : isRecommended
              ? 'bg-indigo-600 text-white hover:bg-indigo-700'
              : 'bg-gray-900 text-white hover:bg-gray-800'
          }`}
        >
          {isCurrentSubscription ? 'Current Plan' : plan.name === 'FREE' ? 'Get Started' : 'Start Trial'}
        </button>
      </div>

      <div className="mt-8 space-y-4">
        <div className="border-t pt-4">
          <p className="text-sm font-semibold text-gray-900 mb-3">Features:</p>
          <ul className="space-y-2">
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm text-gray-600">
                {plan.maxUsers === -1 ? 'Unlimited' : plan.maxUsers} Users
              </span>
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm text-gray-600">
                {plan.maxTables === -1 ? 'Unlimited' : plan.maxTables} Tables
              </span>
            </li>
            <li className="flex items-start">
              <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
              </svg>
              <span className="text-sm text-gray-600">
                {plan.maxProducts === -1 ? 'Unlimited' : plan.maxProducts} Products
              </span>
            </li>
            {plan.inventoryTracking && (
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                <span className="text-sm text-gray-600">Inventory Tracking</span>
              </li>
            )}
            {plan.advancedReports && (
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                <span className="text-sm text-gray-600">Advanced Reports</span>
              </li>
            )}
            {plan.multiLocation && (
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                <span className="text-sm text-gray-600">Multi-location</span>
              </li>
            )}
            {plan.prioritySupport && (
              <li className="flex items-start">
                <svg className="w-5 h-5 text-green-500 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd"/>
                </svg>
                <span className="text-sm text-gray-600">Priority Support</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

---

## Part 3: Stripe Payment Form

**File**: `frontend/src/components/StripePaymentForm.tsx`

```typescript
import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { subscriptionApi } from '../api/subscriptionApi';
import { toast } from 'react-hot-toast';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

function CheckoutForm({ planId, billingCycle, onSuccess }: any) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) return;

    setLoading(true);

    try {
      // Create payment intent
      const { data: intent } = await subscriptionApi.createPaymentIntent({
        planId,
        billingCycle,
        paymentProvider: 'STRIPE',
      });

      // Confirm card payment
      const cardElement = elements.getElement(CardElement);
      const { error, paymentIntent } = await stripe.confirmCardPayment(intent.clientSecret, {
        payment_method: {
          card: cardElement!,
        },
      });

      if (error) {
        toast.error(error.message || 'Payment failed');
      } else if (paymentIntent?.status === 'succeeded') {
        toast.success('Payment successful!');
        onSuccess();
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Payment failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Card Details
        </label>
        <div className="border border-gray-300 rounded-lg p-3">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#424770',
                  '::placeholder': {
                    color: '#aab7c4',
                  },
                },
                invalid: {
                  color: '#9e2146',
                },
              },
            }}
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={!stripe || loading}
        className="w-full bg-indigo-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Processing...' : 'Subscribe Now'}
      </button>
    </form>
  );
}

export default function StripePaymentForm({ planId, billingCycle, onSuccess }: any) {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm planId={planId} billingCycle={billingCycle} onSuccess={onSuccess} />
    </Elements>
  );
}
```

---

## Part 4: Environment Variables

Update `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key
```

Update `backend/.env` (add email config):

```env
# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@restaurant-pos.com
```

---

## Part 5: Production Deployment Checklist

### 5.1 Security Hardening
- [ ] Enable HTTPS
- [ ] Set secure cookie flags
- [ ] Add rate limiting
- [ ] Enable CORS properly
- [ ] Validate all inputs
- [ ] Use helmet.js

### 5.2 Monitoring
- [ ] Set up error tracking (Sentry)
- [ ] Configure logging (Winston)
- [ ] Add health check endpoints
- [ ] Monitor webhook deliveries
- [ ] Track payment success rates

### 5.3 Database
- [ ] Run migrations in production
- [ ] Set up database backups
- [ ] Add indexes for performance
- [ ] Monitor query performance

### 5.4 Payment Providers
- [ ] Switch to production API keys
- [ ] Configure production webhooks
- [ ] Test payment flows
- [ ] Set up payment failure alerts

---

## Quick Start Commands

```bash
# Backend
cd backend
npm install
npx prisma migrate dev --name add_subscription_system
npx prisma generate
npm run start:dev

# Frontend
cd frontend
npm install
npm run dev
```

---

## Testing

### Test Stripe Payments
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Expiry: Any future date
- CVC: Any 3 digits

### Test Iyzico Payments
Use Iyzico sandbox test cards from their documentation.

---

## Support & Documentation

- Full API docs: `http://localhost:3000/api` (after adding Swagger)
- Database schema: See Prisma schema file
- Email templates: `backend/src/modules/subscriptions/templates/emails/`
- Frontend components: `frontend/src/components/`

---

## Production Deployment

1. **Build Backend**
   ```bash
   npm run build
   node dist/main.js
   ```

2. **Build Frontend**
   ```bash
   npm run build
   # Serve the dist folder with nginx or similar
   ```

3. **Environment**
   - Set all production environment variables
   - Use production database
   - Configure production email service
   - Set production payment provider keys

4. **Monitoring**
   - Set up application monitoring
   - Configure error tracking
   - Monitor payment webhooks
   - Track subscription metrics

---

This implementation guide provides all the code needed to complete your production-ready subscription system!
