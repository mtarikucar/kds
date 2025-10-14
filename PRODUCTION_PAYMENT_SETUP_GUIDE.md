# Production Payment Gateway Setup Guide

This guide provides step-by-step instructions for setting up production-ready payment processing with Stripe and Iyzico.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Stripe Setup (International Payments)](#stripe-setup)
3. [Iyzico Setup (Turkey Payments)](#iyzico-setup)
4. [Backend Configuration](#backend-configuration)
5. [Webhook Setup](#webhook-setup)
6. [Security Considerations](#security-considerations)
7. [Testing](#testing)
8. [Go Live Checklist](#go-live-checklist)
9. [Monitoring & Maintenance](#monitoring--maintenance)

---

## Prerequisites

### Business Requirements
- [ ] Business registration documents
- [ ] Bank account for receiving payments
- [ ] SSL certificate for your domain (HTTPS required)
- [ ] Terms of Service and Privacy Policy URLs
- [ ] Refund policy documentation

### Technical Requirements
- [ ] Domain with HTTPS enabled
- [ ] Server with public IP address
- [ ] Access to environment variables
- [ ] Email service configured (for receipts)
- [ ] Database backups enabled

---

## Stripe Setup (International Payments)

### Step 1: Create Stripe Account

1. Go to [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)
2. Create an account with your business email
3. Verify your email address

### Step 2: Complete Business Verification

1. Navigate to **Settings** → **Business Settings**
2. Fill in your business information:
   - Legal business name
   - Business type (Individual, Company, Non-profit)
   - Industry and business description
   - Tax ID / VAT number
   - Business address
3. Add bank account details for payouts:
   - Bank name
   - Account holder name
   - IBAN / Account number
   - Routing number (US)
4. Upload verification documents (if requested):
   - Business license
   - ID verification
   - Proof of address

### Step 3: Get API Keys

1. Navigate to **Developers** → **API Keys**
2. You'll see two types of keys:
   - **Test mode keys** (for development)
   - **Production keys** (for live payments)

#### Test Keys (Already configured in your project):
```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

#### Production Keys (Copy these):
```bash
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
```

**⚠️ IMPORTANT**: Never commit production keys to version control!

### Step 4: Create Products and Prices

You have two options:

#### Option A: Automatic (Using Prisma Seed)
The seed script will automatically create products in Stripe when you run:
```bash
npm run seed
```

#### Option B: Manual Setup
1. Go to **Products** → **Add Product**
2. Create products for each plan:

**Free Plan**
- Name: `Free Plan`
- Recurring: Monthly
- Price: $0.00
- Currency: USD

**Basic Plan**
- Name: `Basic Plan`
- Recurring: Monthly / Yearly
- Monthly Price: $29.00
- Yearly Price: $290.00
- Currency: USD

**Pro Plan**
- Name: `Pro Plan`
- Recurring: Monthly / Yearly
- Monthly Price: $79.00
- Yearly Price: $790.00
- Currency: USD

**Business Plan**
- Name: `Business Plan`
- Recurring: Monthly / Yearly
- Monthly Price: $199.00
- Yearly Price: $1990.00
- Currency: USD

3. Copy the Price IDs (price_xxxx) - you'll need these later

### Step 5: Configure Webhooks

1. Navigate to **Developers** → **Webhooks**
2. Click **Add Endpoint**
3. Configure webhook:
   - **URL**: `https://yourdomain.com/api/webhooks/stripe`
   - **Description**: Production Subscription Webhooks
   - **Events to send**:
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `invoice.paid`
     - `invoice.payment_failed`
     - `customer.subscription.created`
     - `customer.subscription.updated`
     - `customer.subscription.deleted`
     - `customer.subscription.trial_will_end`

4. Click **Add Endpoint**
5. Copy the **Signing Secret** (whsec_xxxxx)

```bash
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx
```

### Step 6: Enable Payment Methods

1. Navigate to **Settings** → **Payment Methods**
2. Enable payment methods for your region:
   - ✅ Cards (Visa, Mastercard, Amex)
   - ✅ Apple Pay
   - ✅ Google Pay
   - ✅ Bank transfers (SEPA, ACH if applicable)

### Step 7: Configure Billing

1. Navigate to **Settings** → **Billing**
2. Set up:
   - Invoice footer (company details)
   - Email receipts: Enabled
   - Default invoice settings
   - Tax ID collection: Enabled (for EU)

---

## Iyzico Setup (Turkey Payments)

### Step 1: Create Iyzico Account

1. Go to [https://merchant.iyzipay.com/](https://merchant.iyzipay.com/)
2. Click **Üye Ol** (Register)
3. Create account with business email
4. Verify email and phone number

### Step 2: Complete Merchant Verification

1. Log in to Iyzico merchant panel
2. Navigate to **Ayarlar** → **Firma Bilgileri** (Settings → Company Info)
3. Fill in required information:
   - Company name (Firma Adı)
   - Tax number (Vergi Numarası)
   - Tax office (Vergi Dairesi)
   - IBAN for settlements
   - Company address
   - Authorized person details
4. Upload required documents:
   - Trade registry gazette (Ticaret sicil gazetesi)
   - Tax plate (Vergi levhası)
   - Signature circular (İmza sirküleri)
   - ID copies of authorized persons

**⏱ Processing Time**: 1-3 business days

### Step 3: Get API Credentials

While your application is being reviewed, you can use sandbox credentials:

#### Sandbox Credentials (Development):
```bash
IYZICO_API_KEY=sandbox-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=sandbox-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
```

#### Production Credentials:
1. After approval, navigate to **Ayarlar** → **API Bilgileri**
2. Copy your production credentials:

```bash
IYZICO_API_KEY=prod-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=prod-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://api.iyzipay.com
```

### Step 4: Configure Webhook Callback

1. Navigate to **Ayarlar** → **Webhook**
2. Set callback URL:
   ```
   https://yourdomain.com/api/webhooks/iyzico
   ```
3. Enable notifications for:
   - Payment success
   - Payment failure
   - Refund completed

### Step 5: Test Cards (Sandbox)

Use these test cards in sandbox mode:

**Successful Payment:**
```
Card Number: 5528 7900 0000 0001
Expiry: 12/2030
CVC: 123
Cardholder: Test User
```

**Failed Payment:**
```
Card Number: 5406 6700 0000 0009
Expiry: 12/2030
CVC: 123
```

### Step 6: Configure Payment Settings

1. Navigate to **Ayarlar** → **Ödeme Ayarları**
2. Configure:
   - Installment options (Taksit seçenekleri)
   - Minimum payment amount
   - Currency: TRY (Turkish Lira)
   - 3D Secure: **Enabled** (mandatory in Turkey)

---

## Backend Configuration

### Step 1: Environment Variables

Create `.env.production` file:

```bash
# Application
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL="postgresql://user:password@host:5432/dbname?schema=public&sslmode=require"

# Redis (for caching and rate limiting)
REDIS_URL="redis://username:password@host:6379"

# JWT
JWT_SECRET=your-production-secret-minimum-32-chars-long-random-string
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-production-refresh-secret-different-from-above
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=https://yourdomain.com

# Stripe (Production)
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

# Iyzico (Production)
IYZICO_API_KEY=prod-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=prod-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://api.iyzipay.com

# Subscription Settings
DEFAULT_TRIAL_DAYS=14
TRIAL_REMINDER_DAYS=3

# Email Configuration (Use production SMTP)
EMAIL_HOST=smtp.sendgrid.net
EMAIL_PORT=587
EMAIL_SECURE=true
EMAIL_USER=apikey
EMAIL_PASSWORD=SG.xxxxxxxxxxxxx
EMAIL_FROM=noreply@yourdomain.com

# Monitoring (Optional)
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
```

### Step 2: Update Frontend Environment

Create `frontend/.env.production`:

```bash
VITE_API_URL=https://api.yourdomain.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxx
VITE_ENVIRONMENT=production
```

### Step 3: Security Headers

Ensure your backend sends proper security headers (already configured in NestJS):
- `Strict-Transport-Security`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `X-XSS-Protection`
- `Content-Security-Policy`

---

## Webhook Setup

### DNS Configuration

Ensure your domain points to your server:
```
yourdomain.com → A record → Your Server IP
api.yourdomain.com → A record → Your Server IP
```

### SSL Certificate

Install SSL certificate (use Let's Encrypt):
```bash
# Install certbot
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com -d api.yourdomain.com

# Auto-renewal (add to crontab)
0 0 1 * * certbot renew --quiet
```

### Nginx Configuration (Reverse Proxy)

Create `/etc/nginx/sites-available/api`:

```nginx
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Webhook endpoints need raw body
    location /api/webhooks {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Important: Don't parse body for webhooks
        proxy_request_buffering off;
    }

    # Regular API endpoints
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        client_max_body_size 10M;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/api /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Test Webhooks

#### Test Stripe Webhook:
```bash
# Install Stripe CLI
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test event
stripe trigger payment_intent.succeeded
```

#### Test Iyzico Webhook:
Use ngrok for local testing:
```bash
ngrok http 3000
# Use the https URL in Iyzico webhook settings
```

---

## Security Considerations

### 1. PCI DSS Compliance

Your application **never** stores raw card data. Both Stripe and Iyzico handle card data:
- ✅ Card data goes directly to payment provider
- ✅ You only store payment tokens/IDs
- ✅ No card numbers in logs
- ✅ No CVV storage

### 2. Data Encryption

- [x] Database encrypted at rest
- [x] SSL/TLS for all API communication
- [x] Encrypted environment variables
- [x] Secure webhook signatures

### 3. Rate Limiting

Add rate limiting to payment endpoints (recommended: 5 requests/minute):

```typescript
// Already configured in your app, but verify limits
@Throttle(5, 60) // 5 requests per 60 seconds
@Post('create-intent')
async createPaymentIntent() {
  // ...
}
```

### 4. Fraud Prevention

- [ ] Implement velocity checks (max transactions per user/IP)
- [ ] Monitor for suspicious patterns
- [ ] Use Stripe Radar (automatic fraud detection)
- [ ] Enable 3D Secure for high-risk transactions
- [ ] Set up alerts for chargebacks

### 5. Logging & Auditing

**DO LOG:**
- Payment attempt timestamps
- Payment status changes
- User IDs and emails
- Transaction amounts
- Webhook events received

**DON'T LOG:**
- Full card numbers
- CVV codes
- Raw card data
- Unencrypted tokens

---

## Testing

### Test Checklist

#### Stripe Testing

- [ ] Create subscription with trial
- [ ] Create subscription without trial
- [ ] Upgrade plan (test prorated payment)
- [ ] Downgrade plan
- [ ] Cancel subscription (immediate)
- [ ] Cancel subscription (at period end)
- [ ] Reactivate cancelled subscription
- [ ] Test failed payment (use test card 4000 0000 0000 0341)
- [ ] Test webhook delivery
- [ ] Test invoice generation
- [ ] Test receipt emails

#### Iyzico Testing

- [ ] Create payment with test card
- [ ] Test 3D Secure flow
- [ ] Test failed payment
- [ ] Test refund
- [ ] Test webhook callback
- [ ] Test Turkish locale/currency

#### Edge Cases

- [ ] Expired card during renewal
- [ ] Insufficient funds
- [ ] Network timeout handling
- [ ] Duplicate payment prevention (idempotency)
- [ ] Concurrent subscription changes
- [ ] Trial ending with no payment method

### Load Testing

Test payment endpoints under load:
```bash
# Install k6
npm install -g k6

# Run load test
k6 run load-test.js
```

---

## Go Live Checklist

### Pre-Launch (1 Week Before)

- [ ] All tests passing in staging
- [ ] Production credentials configured
- [ ] Webhooks tested and verified
- [ ] SSL certificates installed
- [ ] Database backups automated
- [ ] Monitoring dashboards set up
- [ ] Error alerting configured
- [ ] Team trained on payment issues
- [ ] Customer support ready
- [ ] Refund process documented

### Launch Day

- [ ] Deploy backend to production
- [ ] Deploy frontend to production
- [ ] Verify webhook endpoints responding
- [ ] Test one real transaction (small amount)
- [ ] Monitor error rates
- [ ] Check email notifications working
- [ ] Verify invoice generation
- [ ] Test subscription lifecycle

### Post-Launch (First 24 Hours)

- [ ] Monitor payment success rate (target >95%)
- [ ] Check webhook delivery rate
- [ ] Review error logs
- [ ] Test customer payment flow
- [ ] Verify receipt emails sent
- [ ] Check revenue reporting
- [ ] Monitor support tickets

### First Week

- [ ] Daily reconciliation (match payments to orders)
- [ ] Review failed payments and patterns
- [ ] Check for any security alerts
- [ ] Verify all invoices generated correctly
- [ ] Test first subscription renewal
- [ ] Monitor chargeback rate (target <0.5%)

---

## Monitoring & Maintenance

### Key Metrics to Track

1. **Payment Success Rate**: >95%
2. **Webhook Delivery Rate**: >99%
3. **Average Payment Processing Time**: <3 seconds
4. **Failed Payment Rate**: <5%
5. **Chargeback Rate**: <0.5%
6. **Refund Rate**: Track and investigate if >10%

### Daily Tasks

- [ ] Review failed payments
- [ ] Check webhook delivery logs
- [ ] Monitor error rates
- [ ] Reconcile payments with bank deposits

### Weekly Tasks

- [ ] Review subscription churn rate
- [ ] Analyze payment failure reasons
- [ ] Check for fraud patterns
- [ ] Update payment success/failure reports
- [ ] Review customer support tickets

### Monthly Tasks

- [ ] Generate financial reports
- [ ] Reconcile with bank statements
- [ ] Review and optimize payment flow
- [ ] Check for API deprecations
- [ ] Update documentation
- [ ] Security audit

### Alerts to Configure

```yaml
# Payment alerts (use your monitoring tool)
alerts:
  - name: High payment failure rate
    condition: failed_payments > 10% in 1 hour
    action: Alert team immediately

  - name: Webhook delivery failure
    condition: webhook_failures > 5 in 10 minutes
    action: Alert DevOps team

  - name: Database connection issues
    condition: payment_endpoint_5xx > 10 in 5 minutes
    action: Page on-call engineer

  - name: Unusual payment volume
    condition: payments > 100 in 10 minutes
    action: Alert fraud team
```

---

## Troubleshooting

### Common Issues

#### Stripe Webhook Not Receiving Events

1. Check webhook URL is publicly accessible
2. Verify SSL certificate is valid
3. Check webhook secret matches
4. Review Stripe dashboard → Webhooks → Recent events
5. Check nginx logs for blocked requests

#### Iyzico Payment Failing

1. Verify 3D Secure is properly implemented
2. Check merchant account is approved
3. Verify IBAN is correct for settlements
4. Check IP whitelist (if configured)
5. Review Iyzico merchant panel logs

#### Payment Success But Subscription Not Created

1. Check webhook handler executed
2. Review application logs
3. Verify database transaction completed
4. Check for duplicate prevention blocking update

#### Emails Not Sending

1. Verify SMTP credentials
2. Check email service quota
3. Review email logs
4. Test with a simple email
5. Check spam folder

---

## Support Contacts

### Stripe Support
- Dashboard: [https://dashboard.stripe.com/support](https://dashboard.stripe.com/support)
- Email: support@stripe.com
- Phone: Available in dashboard
- Docs: [https://stripe.com/docs](https://stripe.com/docs)

### Iyzico Support
- Merchant Panel: [https://merchant.iyzipay.com/](https://merchant.iyzipay.com/)
- Email: destek@iyzico.com
- Phone: +90 (212) 981 8603
- Docs: [https://dev.iyzipay.com/](https://dev.iyzipay.com/)

---

## Next Steps

After completing this setup:

1. ✅ Review [SECURITY_IMPROVEMENTS.md](./SECURITY_IMPROVEMENTS.md) for additional hardening
2. ✅ Implement monitoring dashboard (see MONITORING_SETUP.md)
3. ✅ Set up automated reconciliation
4. ✅ Create customer payment portal
5. ✅ Implement advanced fraud detection

---

**Last Updated**: 2025-10-10
**Version**: 1.0.0
**Maintained By**: Development Team
