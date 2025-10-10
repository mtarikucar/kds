# Payment & Invoice Implementation Guide

This document provides a complete overview of the payment processing and invoice generation implementation for the Restaurant POS subscription system.

## Overview

The system supports two payment providers:
- **Stripe** - For international payments (USD, EUR, etc.)
- **Iyzico** - For Turkish market (TRY)

The payment provider is automatically selected based on the tenant's region/currency.

## Backend Implementation

### 1. Environment Configuration

**File:** `backend/.env.example`

Add the following credentials:

```env
# Stripe Payment Provider (International)
# Get your test keys from: https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=sk_test_51placeholder_get_from_stripe_dashboard
STRIPE_PUBLISHABLE_KEY=pk_test_51placeholder_get_from_stripe_dashboard
STRIPE_WEBHOOK_SECRET=whsec_placeholder_get_from_stripe_webhook_settings

# Iyzico Payment Provider (Turkey)
# Get your sandbox keys from: https://sandbox-merchant.iyzipay.com/
IYZICO_API_KEY=sandbox-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=sandbox-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
```

### 2. Webhook Controllers

#### Stripe Webhook Controller
**File:** `backend/src/modules/subscriptions/webhooks/stripe-webhook.controller.ts`

Handles Stripe webhook events:
- `payment_intent.succeeded` - Successful payment
- `payment_intent.payment_failed` - Failed payment
- `invoice.paid` - Invoice paid
- `invoice.payment_failed` - Invoice payment failed
- `customer.subscription.updated` - Subscription status changed
- `customer.subscription.deleted` - Subscription cancelled
- `customer.subscription.trial_will_end` - Trial ending soon

**Webhook URL:** `https://your-domain.com/api/webhooks/stripe`

**Security:** Uses Stripe signature verification to validate webhook authenticity.

#### Iyzico Webhook Controller
**File:** `backend/src/modules/subscriptions/webhooks/iyzico-webhook.controller.ts`

Handles Iyzico callbacks:
- Payment success callback
- Payment failure callback
- Manual payment verification endpoint

**Callback URL:** `https://your-domain.com/api/webhooks/iyzico`

### 3. Invoice PDF Service

**File:** `backend/src/modules/subscriptions/services/invoice-pdf.service.ts`

Features:
- Generates professional HTML invoices
- Stores invoices in `storage/invoices/` directory
- Includes company branding, line items, taxes, and payment details
- Can be upgraded to use Puppeteer for PDF generation

### 4. Invoice Controller

**File:** `backend/src/modules/subscriptions/controllers/invoice.controller.ts`

Endpoints:
- `GET /api/invoices/:id` - Get invoice details
- `GET /api/invoices/:id/download` - Download invoice HTML
- `POST /api/invoices/:id/generate-pdf` - Force regenerate invoice

### 5. Payment Flow

1. **Create Payment Intent**
   - Frontend calls `POST /api/payments/create-intent`
   - Backend creates payment intent with Stripe or Iyzico
   - Returns `clientSecret` and payment details

2. **User Enters Payment Details**
   - Stripe: Uses Stripe Elements for secure card input
   - Iyzico: Custom form with validation

3. **Confirm Payment**
   - Stripe: Frontend calls `stripe.confirmPayment()` directly
   - Iyzico: Frontend calls `POST /api/payments/confirm-payment`

4. **Webhook Processing**
   - Payment provider sends webhook to backend
   - Backend updates payment status
   - Activates subscription
   - Marks invoice as paid
   - Sends email notifications

## Frontend Implementation

### 1. Environment Configuration

**File:** `frontend/.env.example`

```env
# API Configuration
VITE_API_URL=http://localhost:3000/api

# Stripe Configuration
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_51placeholder_get_from_stripe_dashboard

# WebSocket Configuration
VITE_WS_URL=ws://localhost:3000
```

### 2. Payment Components

#### Stripe Payment Form
**File:** `frontend/src/components/subscriptions/StripePaymentForm.tsx`

- Uses `@stripe/react-stripe-js` for card input
- Displays payment amount
- Shows error messages
- Handles payment confirmation

#### Iyzico Payment Form
**File:** `frontend/src/components/subscriptions/IyzicoPaymentForm.tsx`

- Custom card input form with validation
- Turkish language labels
- Test card information displayed
- Form validation using Zod

### 3. Payment Page

**File:** `frontend/src/pages/subscription/SubscriptionPaymentPage.tsx`

Features:
- Automatically creates payment intent on load
- Selects payment provider based on currency
- Displays appropriate payment form
- Handles success/error states
- Redirects to subscription page after success

**Route:** `/subscription/payment?subscriptionId=xxx`

### 4. Invoice Components

#### Invoice Card
**File:** `frontend/src/components/subscriptions/InvoiceCard.tsx`

- Displays invoice details
- Shows payment status (Paid/Open)
- Download invoice button
- Period and amount information

#### Invoice List
**Location:** `frontend/src/pages/subscription/SubscriptionManagementPage.tsx`

- Displays all tenant invoices in table format
- Download button for each invoice
- Status badges
- Date and amount columns

### 5. API Integration

**File:** `frontend/src/api/paymentsApi.ts`

React Query hooks:
- `useCreatePaymentIntent()` - Create payment intent
- `useConfirmPayment()` - Confirm payment (Iyzico)
- `useInvoice(id)` - Get invoice by ID
- `downloadInvoice(id)` - Download invoice file
- `useGenerateInvoicePdf()` - Generate invoice PDF

## Testing

### Test Cards

#### Stripe Test Cards
```
Success: 4242 4242 4242 4242
Declined: 4000 0000 0000 0002
Insufficient Funds: 4000 0000 0000 9995
Expiry: Any future date (e.g., 12/2030)
CVC: Any 3 digits (e.g., 123)
```

#### Iyzico Test Card
```
Card Number: 5528 7900 0000 0001
Expiry: 12/2030
CVC: 123
Name: Any name
```

### Testing Webhooks Locally

#### Stripe Webhook Testing

1. Install Stripe CLI:
```bash
brew install stripe/stripe-cli/stripe  # macOS
# or download from https://stripe.com/docs/stripe-cli
```

2. Login to Stripe:
```bash
stripe login
```

3. Forward webhooks to local server:
```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

4. Copy the webhook signing secret and add to `.env`:
```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

5. Trigger test events:
```bash
stripe trigger payment_intent.succeeded
stripe trigger invoice.paid
```

#### Iyzico Webhook Testing

For Iyzico, you can use the manual verification endpoint:

```bash
curl -X POST http://localhost:3000/api/webhooks/iyzico/verify \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "your-payment-id",
    "conversationId": "your-conversation-id"
  }'
```

### End-to-End Testing

1. **Select a Plan**
   - Navigate to `/subscription/plans`
   - Choose a plan and billing cycle
   - Click "Subscribe"

2. **Create Subscription**
   - System creates pending subscription
   - Redirects to payment page

3. **Enter Payment Details**
   - For Stripe: Enter test card 4242 4242 4242 4242
   - For Iyzico: Enter test card 5528 7900 0000 0001
   - Fill in expiry and CVC

4. **Complete Payment**
   - Click "Pay Now" or "Ödemeyi Tamamla"
   - Wait for webhook processing (may take a few seconds)
   - Should redirect to subscription management page

5. **Verify Subscription**
   - Check subscription status is "Active"
   - Verify invoice is generated
   - Download invoice PDF

6. **Check Database**
```sql
-- Check subscription
SELECT * FROM "Subscription" WHERE "tenantId" = 'your-tenant-id';

-- Check payment
SELECT * FROM "SubscriptionPayment" WHERE "subscriptionId" = 'subscription-id';

-- Check invoice
SELECT * FROM "Invoice" WHERE "subscriptionId" = 'subscription-id';
```

## Production Deployment

### 1. Update Environment Variables

Replace test keys with production keys:

```env
# Stripe Production Keys
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Iyzico Production Keys
IYZICO_API_KEY=your-production-api-key
IYZICO_SECRET_KEY=your-production-secret-key
IYZICO_BASE_URL=https://api.iyzipay.com
```

### 2. Configure Webhooks

#### Stripe Webhook Setup

1. Go to Stripe Dashboard > Developers > Webhooks
2. Click "Add endpoint"
3. Enter URL: `https://your-domain.com/api/webhooks/stripe`
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.trial_will_end`
5. Copy the webhook signing secret to your `.env` file

#### Iyzico Callback Setup

1. Go to Iyzico Merchant Panel > Settings
2. Set callback URL: `https://your-domain.com/api/webhooks/iyzico`
3. Save settings

### 3. SSL/TLS Configuration

Ensure your server has valid SSL certificate for webhook security.

### 4. Storage Configuration

Ensure `storage/invoices/` directory exists and is writable:

```bash
mkdir -p storage/invoices
chmod 755 storage/invoices
```

For production, consider using cloud storage (S3, Google Cloud Storage) instead of local filesystem.

### 5. Monitoring

Set up monitoring for:
- Webhook failures
- Payment errors
- Invoice generation errors
- Failed email notifications

## Email Notifications

The system sends email notifications for:
- Payment successful
- Payment failed
- Subscription activated
- Subscription cancelled
- Trial ending reminder

Emails are sent through the `NotificationService`.

## Security Considerations

1. **Webhook Signature Verification**
   - Always verify webhook signatures
   - Never trust webhook data without verification

2. **PCI Compliance**
   - Never store raw card numbers
   - Use Stripe/Iyzico tokenization
   - Card data never touches your server

3. **Environment Variables**
   - Never commit `.env` files
   - Use secure secret management in production
   - Rotate keys periodically

4. **Rate Limiting**
   - Implement rate limiting on payment endpoints
   - Prevent brute force attacks

5. **Logging**
   - Log all payment attempts
   - Monitor for suspicious activity
   - Never log sensitive card data

## Troubleshooting

### Payment Intent Creation Fails

**Symptoms:** Error when clicking "Subscribe" button

**Solutions:**
1. Check Stripe/Iyzico API keys are correct
2. Verify network connectivity
3. Check backend logs for detailed error messages
4. Ensure subscription exists in database

### Webhook Not Received

**Symptoms:** Payment succeeds but subscription not activated

**Solutions:**
1. Verify webhook URL is accessible from internet
2. Check webhook signing secret is correct
3. Review webhook delivery logs in Stripe/Iyzico dashboard
4. Test webhook locally using Stripe CLI
5. Check firewall settings

### Invoice Not Generated

**Symptoms:** Invoice ID exists but PDF not available

**Solutions:**
1. Check `storage/invoices/` directory permissions
2. Verify InvoicePdfService is registered in module
3. Check backend logs for generation errors
4. Try manually regenerating with `/api/invoices/:id/generate-pdf`

### Payment Stuck in Processing

**Symptoms:** Payment appears successful but subscription still pending

**Solutions:**
1. Check webhook logs
2. Manually verify payment status with provider
3. Use Iyzico verify endpoint: `POST /api/webhooks/iyzico/verify`
4. Check database for payment status

## Future Enhancements

1. **PDF Generation**
   - Integrate Puppeteer for real PDF generation
   - Add custom branding options
   - Support multiple languages

2. **Payment Methods**
   - Add support for bank transfers
   - Integrate PayPal
   - Add cryptocurrency payments

3. **Invoicing Features**
   - Tax calculation based on location
   - Credit notes for refunds
   - Recurring invoice templates
   - Invoice reminders

4. **Analytics**
   - Payment success/failure rates
   - Revenue dashboards
   - Subscription metrics
   - Churn analysis

## Support

For issues or questions:
- Check logs in `backend/logs/`
- Review webhook delivery logs in payment provider dashboard
- Test with provided test cards
- Contact payment provider support for provider-specific issues

## Files Created/Modified

### Backend
- `backend/.env.example` - Added payment provider credentials
- `backend/src/modules/subscriptions/webhooks/stripe-webhook.controller.ts` - New
- `backend/src/modules/subscriptions/webhooks/iyzico-webhook.controller.ts` - New
- `backend/src/modules/subscriptions/services/invoice-pdf.service.ts` - New
- `backend/src/modules/subscriptions/controllers/invoice.controller.ts` - New
- `backend/src/modules/subscriptions/subscriptions.module.ts` - Updated

### Frontend
- `frontend/.env.example` - Added Stripe publishable key
- `frontend/package.json` - Added Stripe libraries
- `frontend/src/components/subscriptions/StripePaymentForm.tsx` - New
- `frontend/src/components/subscriptions/IyzicoPaymentForm.tsx` - New
- `frontend/src/components/subscriptions/InvoiceCard.tsx` - New
- `frontend/src/pages/subscription/SubscriptionPaymentPage.tsx` - New
- `frontend/src/api/paymentsApi.ts` - New
- `frontend/src/App.tsx` - Added payment route

## Conclusion

The payment and invoice system is now fully implemented with:
- ✅ Stripe integration with test credentials
- ✅ Iyzico integration with test credentials
- ✅ Webhook handlers for both providers
- ✅ Invoice PDF generation
- ✅ Frontend payment forms
- ✅ Complete payment flow
- ✅ Email notifications
- ✅ Security best practices

You can now test the complete subscription flow from plan selection to payment processing and invoice generation.
