# How to Get Real Payment API Credentials

This guide will walk you through getting production API credentials from both Stripe and Iyzico payment providers.

---

## 🔷 STRIPE (International Payments)

### Step 1: Create Stripe Account

1. Go to https://stripe.com
2. Click "Start now" or "Sign up"
3. Fill in your business information:
   - Email address
   - Full name
   - Country (select your business location)
   - Password

### Step 2: Verify Your Email

1. Check your email inbox
2. Click the verification link from Stripe
3. Complete email verification

### Step 3: Get Test API Keys (For Development)

1. Log in to your Stripe Dashboard: https://dashboard.stripe.com
2. Click "Developers" in the left sidebar
3. Click "API keys"
4. You'll see two keys:
   - **Publishable key** (starts with `pk_test_`)
   - **Secret key** (starts with `sk_test_`) - Click "Reveal test key"

**Copy these keys to your `.env` file:**

```env
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx
```

### Step 4: Set Up Webhooks (For Payment Notifications)

1. In Stripe Dashboard, go to "Developers" → "Webhooks"
2. Click "+ Add endpoint"
3. Enter your webhook URL:
   - Development: `https://your-ngrok-url.ngrok.io/api/webhooks/stripe`
   - Production: `https://yourdomain.com/api/webhooks/stripe`
4. Select events to listen to:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Click "Add endpoint"
6. Copy the "Signing secret" (starts with `whsec_`)

**Add to your `.env` file:**

```env
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx
```

### Step 5: Activate Your Account (For Production)

To accept real payments, you need to activate your Stripe account:

1. In Dashboard, click "Activate your account" banner
2. Complete business verification:
   - Business type (Individual, Company, Non-profit)
   - Business details
   - Personal details
   - Bank account information (for payouts)
   - Tax information
3. Upload required documents:
   - Government-issued ID
   - Business registration (if applicable)
   - Bank statement (if requested)
4. Wait for verification (usually 1-2 business days)

### Step 6: Get Live API Keys

Once your account is activated:

1. Go to "Developers" → "API keys"
2. Toggle from "Test mode" to "Live mode" (switch at top)
3. Copy your live keys:
   - **Publishable key** (starts with `pk_live_`)
   - **Secret key** (starts with `sk_live_`)

**Update your production `.env` file:**

```env
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxxxxxxxxxxxxxxxxxxxx
```

### Test Cards (For Development)

Use these test card numbers in test mode:

- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002
- **3D Secure Required**: 4000 0025 0000 3155
- Any future expiry date, any CVC

---

## 🔶 IYZICO (Turkey Payments)

### Step 1: Create Iyzico Merchant Account

1. Go to https://www.iyzico.com/
2. Click "Üye Ol" (Sign Up)
3. Fill in the registration form:
   - Business name
   - Email address
   - Phone number
   - Password

### Step 2: Complete Business Registration

1. Log in to Merchant Panel: https://merchant.iyzipay.com/
2. Complete the "Know Your Customer" (KYC) process:
   - Company information
   - Tax information (Vergi numarası)
   - Bank account details (IBAN)
   - Upload documents:
     - Trade registry gazette (Ticaret sicil gazetesi)
     - Tax plate (Vergi levhası)
     - Signature circular (İmza sirküleri)
     - ID copies of authorized persons

### Step 3: Get Sandbox (Test) Credentials

1. While your account is being verified, you can use sandbox credentials
2. Go to https://sandbox-merchant.iyzipay.com/
3. Log in with your sandbox account
4. Navigate to "Ayarlar" (Settings) → "API Bilgileri" (API Information)
5. Copy your sandbox credentials:
   - **API Key**: sandbox-xxxxxxxxxxxxx
   - **Secret Key**: sandbox-yyyyyyyyyyyyy

**Add to your development `.env` file:**

```env
IYZICO_API_KEY=sandbox-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=sandbox-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
```

### Step 4: Generate Webhook Secret

Generate a random 32+ character string for webhook verification:

**On Linux/Mac:**
```bash
openssl rand -base64 32
```

**On Windows (PowerShell):**
```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 32 | % {[char]$_})
```

**Add to your `.env` file:**

```env
IYZICO_WEBHOOK_SECRET=your-random-32-char-secret-here
```

### Step 5: Configure Webhooks

1. In Iyzico Merchant Panel, go to "Ayarlar" → "Webhook"
2. Add your webhook URL:
   - Development: `https://your-ngrok-url.ngrok.io/api/webhooks/iyzico`
   - Production: `https://yourdomain.com/api/webhooks/iyzico`
3. Save the configuration

### Step 6: Get Production Credentials

After your account is verified and approved (usually 3-5 business days):

1. Log in to Production Merchant Panel: https://merchant.iyzipay.com/
2. Navigate to "Ayarlar" → "API Bilgileri"
3. Copy your production credentials:
   - **API Key**: Your production API key
   - **Secret Key**: Your production secret key

**Update your production `.env` file:**

```env
IYZICO_API_KEY=your-production-api-key
IYZICO_SECRET_KEY=your-production-secret-key
IYZICO_BASE_URL=https://api.iyzipay.com
```

### Test Cards (For Sandbox)

Use these test card numbers in sandbox mode:

- **Success**: 5528 7900 0000 0001
- **Decline**: 5406 6700 0000 0009
- Expiry: 12/2030
- CVC: 123
- Cardholder: Test User

### Documents Required for Iyzico

For Turkish businesses:
- Trade registry gazette (Ticaret sicil gazetesi)
- Tax plate (Vergi levhası)
- Signature circular (İmza sirküleri)
- ID copies of company partners/authorized persons
- Company activity certificate

For individual entrepreneurs:
- Tax plate
- ID copy
- Bank account statement

---

## 🔧 Setting Up Local Development with Ngrok

Since payment providers need to send webhooks to your server, you need a public URL for local development:

### Step 1: Install Ngrok

1. Go to https://ngrok.com/
2. Sign up for free account
3. Download ngrok for your OS
4. Extract and install

### Step 2: Get Auth Token

1. Log in to ngrok dashboard
2. Copy your auth token
3. Run: `ngrok authtoken YOUR_AUTH_TOKEN`

### Step 3: Start Ngrok Tunnel

```bash
ngrok http 3000
```

This will give you a public URL like: `https://abc123.ngrok.io`

### Step 4: Update Webhook URLs

Use this ngrok URL for webhook endpoints:
- Stripe: `https://abc123.ngrok.io/api/webhooks/stripe`
- Iyzico: `https://abc123.ngrok.io/api/webhooks/iyzico`

---

## 📝 Complete Environment Configuration

Here's your complete `.env` file template:

```env
# Application
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/restaurant_pos?schema=public"

# Redis
REDIS_URL="redis://127.0.0.1:6379"

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-super-secret-refresh-key
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=http://localhost:5173

# File Upload
MAX_FILE_SIZE=5242880
UPLOAD_PATH=./uploads

# Pagination
DEFAULT_PAGE_SIZE=20
MAX_PAGE_SIZE=100

# Stripe Payment Provider (International)
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx

# Iyzico Payment Provider (Turkey)
IYZICO_API_KEY=sandbox-xxxxxxxxxxxxx
IYZICO_SECRET_KEY=sandbox-yyyyyyyyyyyyy
IYZICO_BASE_URL=https://sandbox-api.iyzipay.com
IYZICO_WEBHOOK_SECRET=your-random-32-char-secret-for-webhook-verification

# Subscription Settings
DEFAULT_TRIAL_DAYS=14
TRIAL_REMINDER_DAYS=3

# Email Configuration
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_SECURE=false
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
EMAIL_FROM=noreply@restaurant-pos.com
```

---

## ✅ Verification Checklist

Before going to production, verify:

### Stripe:
- [ ] Account is activated and verified
- [ ] Live API keys obtained
- [ ] Webhooks configured with live endpoint
- [ ] Test payments successful in test mode
- [ ] Bank account connected for payouts
- [ ] Business information complete

### Iyzico:
- [ ] KYC verification completed
- [ ] All required documents uploaded
- [ ] Account approved by Iyzico
- [ ] Production API keys obtained
- [ ] Webhooks configured with production endpoint
- [ ] Test payments successful in sandbox
- [ ] Bank account verified

### General:
- [ ] SSL certificate installed on production domain
- [ ] Webhook endpoints are publicly accessible
- [ ] Environment variables updated in production
- [ ] Test both payment providers in production
- [ ] Monitor logs for any errors
- [ ] Set up payment failure alerts

---

## 🆘 Troubleshooting

### Stripe Issues

**Problem**: "No such customer" error
- **Solution**: Make sure you're using the correct API keys (test vs live)

**Problem**: Webhook signature verification fails
- **Solution**: Ensure you're using the correct webhook secret for the environment

**Problem**: "Your account cannot currently make live charges"
- **Solution**: Complete account activation process

### Iyzico Issues

**Problem**: "Authentication failed" error
- **Solution**: Double-check API key and secret key are correct

**Problem**: "Invalid IP address" error
- **Solution**: Ensure you're passing the correct client IP address

**Problem**: "Merchant not found" error
- **Solution**: Verify you're using production URL with production credentials

### Webhook Issues

**Problem**: Webhooks not received
- **Solution**:
  1. Check firewall settings
  2. Verify webhook URL is publicly accessible
  3. Check webhook logs in provider dashboard
  4. Ensure your server is running

**Problem**: Webhook signature verification fails
- **Solution**:
  1. Verify webhook secret is correct
  2. Check you're reading raw request body
  3. Ensure no middleware is modifying the request

---

## 📞 Support Contacts

### Stripe Support
- Dashboard: https://dashboard.stripe.com/support
- Documentation: https://stripe.com/docs
- Email: support@stripe.com
- Phone: Available in dashboard

### Iyzico Support
- Merchant Panel: https://merchant.iyzipay.com/
- Documentation: https://dev.iyzipay.com/
- Email: destek@iyzico.com
- Phone: +90 (212) 981 51 22

---

## 🚀 Next Steps

1. Get your test credentials and start development
2. Test payment flows thoroughly
3. Apply for production accounts (this takes time)
4. While waiting, continue development with test credentials
5. Once approved, update to production credentials
6. Deploy to production
7. Monitor transactions closely

Good luck with your payment integration!
