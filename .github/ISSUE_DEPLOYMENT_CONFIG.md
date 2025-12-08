# 🚨 Deployment Configuration Missing

## Environment Configuration
Missing or incomplete configuration for both **Beta** and **Production** environments.

## Required Configurations

### 1. Email Service
- [ ] `EMAIL_HOST` - SMTP server
- [ ] `EMAIL_PORT` - SMTP port (587 for TLS)
- [ ] `EMAIL_USER` - Email account
- [ ] `EMAIL_PASSWORD` - App password or API key
- [ ] `EMAIL_FROM` - Sender address

**Note:** For Gmail, create App Password at https://myaccount.google.com/apppasswords

### 2. Payment Providers

#### Stripe (International)
- [ ] `STRIPE_SECRET_KEY` - Production key (sk_live_...)
- [ ] `STRIPE_PUBLISHABLE_KEY` - Production key (pk_live_...)
- [ ] `STRIPE_WEBHOOK_SECRET` - Webhook signing secret

**Get from:** https://dashboard.stripe.com/apikeys

#### Iyzico (Turkey)
- [ ] `IYZICO_API_KEY` - Production API key
- [ ] `IYZICO_SECRET_KEY` - Production secret key
- [ ] `IYZICO_BASE_URL` - `https://api.iyzipay.com`
- [ ] `IYZICO_WEBHOOK_SECRET` - Generated secret (32 chars)

**Get from:** https://merchant.iyzipay.com/

### 3. GitHub Secrets for CI/CD

#### Beta Environment
- [ ] `BETA_SERVER_HOST` - Beta server IP/hostname
- [ ] `BETA_SERVER_USER` - SSH user
- [ ] `SSH_PRIVATE_KEY` - SSH key for server access
- [ ] `SSH_KNOWN_HOSTS` - Server fingerprint

#### Test/Sandbox Keys (Beta/Staging)
- [ ] `STRIPE_TEST_SECRET_KEY`
- [ ] `STRIPE_TEST_PUBLISHABLE_KEY`
- [ ] `IYZICO_SANDBOX_API_KEY`
- [ ] `IYZICO_SANDBOX_SECRET_KEY`

#### Database & Services
- [ ] `POSTGRES_PASSWORD`
- [ ] `REDIS_PASSWORD`
- [ ] `JWT_SECRET` (64+ chars)
- [ ] `JWT_REFRESH_SECRET` (64+ chars)

## Quick Setup Commands

### Generate JWT Secrets
```bash
openssl rand -base64 64
```

### Generate Webhook Secret
```bash
openssl rand -base64 32
```

### Test SSH Connection
```bash
ssh -i ~/.ssh/id_rsa user@beta-server
```

## References
- Template: `backend/.env.production.template`
- Template: `backend/.env.staging.template`
- Docs: `docs/DEPLOYMENT.md`

## Priority
🔴 **HIGH** - Required for deployment to work
