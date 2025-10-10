# Subscription System Deployment Checklist

## Pre-Deployment Verification

### 1. Environment Configuration
- [ ] Copy `.env.docker` to `.env`
- [ ] Update `POSTGRES_PASSWORD` with strong password
- [ ] Update `JWT_SECRET` and `JWT_REFRESH_SECRET` with random strings
- [ ] Add Stripe API keys from https://dashboard.stripe.com/apikeys
  - [ ] `STRIPE_SECRET_KEY` (use `sk_test_...` for testing, `sk_live_...` for production)
  - [ ] `STRIPE_PUBLISHABLE_KEY` (use `pk_test_...` for testing, `pk_live_...` for production)
- [ ] Add Iyzico credentials from merchant panel
  - [ ] `IYZICO_API_KEY`
  - [ ] `IYZICO_SECRET_KEY`
  - [ ] `IYZICO_BASE_URL` (sandbox for testing, production for live)
- [ ] Configure email SMTP settings
  - [ ] `EMAIL_HOST` (e.g., smtp.gmail.com)
  - [ ] `EMAIL_PORT` (usually 587)
  - [ ] `EMAIL_USER`
  - [ ] `EMAIL_PASSWORD` (use app-specific password for Gmail)
  - [ ] `EMAIL_FROM`
- [ ] Set `CORS_ORIGIN` to frontend URL
- [ ] Set `VITE_API_URL` to backend URL
- [ ] Set `VITE_STRIPE_PUBLISHABLE_KEY` (same as STRIPE_PUBLISHABLE_KEY)

### 2. Database Setup
- [ ] Ensure Docker and Docker Compose are installed (20.10+ and 2.0+)
- [ ] Verify at least 2GB RAM and 10GB disk space available
- [ ] Start database services: `docker-compose up -d postgres redis`
- [ ] Wait for health checks to pass: `docker-compose ps`
- [ ] Run Prisma migrations: `docker-compose exec backend npx prisma migrate deploy`
- [ ] Generate Prisma client: `docker-compose exec backend npx prisma generate`

### 3. Subscription Plans Seeding
- [ ] Create seed script if not exists: `prisma/seed-subscriptions.ts`
- [ ] Run seed script: `docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts`
- [ ] Verify plans created: Check database or use Prisma Studio

### 4. Payment Provider Configuration

#### Stripe Webhooks
- [ ] Go to https://dashboard.stripe.com/webhooks
- [ ] Add endpoint: `https://yourdomain.com/webhooks/stripe` (or use ngrok for testing)
- [ ] Select events:
  - [ ] `payment_intent.succeeded`
  - [ ] `payment_intent.payment_failed`
  - [ ] `customer.subscription.created`
  - [ ] `customer.subscription.updated`
  - [ ] `customer.subscription.deleted`
  - [ ] `invoice.payment_succeeded`
  - [ ] `invoice.payment_failed`
- [ ] Copy webhook secret to `.env` as `STRIPE_WEBHOOK_SECRET`
- [ ] Restart backend: `docker-compose restart backend`

#### Iyzico Callbacks
- [ ] Configure in Iyzico merchant panel
- [ ] Set callback URL: `https://yourdomain.com/webhooks/iyzico`

### 5. Email Service Testing
- [ ] Start all services: `docker-compose up -d`
- [ ] Check backend logs for email connection: `docker-compose logs backend | grep -i email`
- [ ] Test email sending (create test subscription with trial)
- [ ] Verify trial-started email received

### 6. Storage Verification
- [ ] Check invoice directory exists: `docker-compose exec backend ls -la /app/storage/invoices`
- [ ] Verify permissions: Directory should be writable
- [ ] Check email templates: `docker-compose exec backend ls -la /app/src/modules/subscriptions/templates/emails`

## Development Deployment

### Start Services
```bash
# Copy environment file
cp .env.docker .env

# Edit with your values
nano .env

# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check status
docker-compose ps
```

### Initialize Database
```bash
# Run migrations
docker-compose exec backend npx prisma migrate deploy

# Seed subscription plans
docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts
```

### Access Points
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Production Deployment

### Pre-Production Steps
- [ ] Use production environment file: `cp .env.docker .env.production`
- [ ] Update all placeholders with production values
- [ ] Use strong passwords (minimum 16 characters)
- [ ] Use production Stripe keys (`sk_live_...`, `pk_live_...`)
- [ ] Use production Iyzico URL: `https://api.iyzipay.com`
- [ ] Configure production email service (not Gmail personal account)
- [ ] Set proper `CORS_ORIGIN` (your frontend domain)
- [ ] Set `VITE_API_URL` to production backend domain

### Build and Deploy
```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# Run migrations
docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Seed plans
docker-compose -f docker-compose.prod.yml exec backend npx ts-node prisma/seed-subscriptions.ts
```

### SSL/TLS Configuration
- [ ] Set up reverse proxy (Nginx, Traefik, or Caddy)
- [ ] Configure SSL certificates (Let's Encrypt recommended)
- [ ] Update webhook URLs to use HTTPS
- [ ] Update CORS_ORIGIN to use HTTPS

### Security Hardening
- [ ] Remove exposed PostgreSQL port (5432) from docker-compose.prod.yml
- [ ] Remove exposed Redis port (6379) from docker-compose.prod.yml
- [ ] Use Docker secrets instead of environment variables for sensitive data
- [ ] Enable firewall rules to restrict access
- [ ] Set up log aggregation (ELK stack or similar)
- [ ] Configure error monitoring (Sentry or similar)

## Post-Deployment Verification

### Functional Testing
- [ ] Visit pricing page: `https://yourdomain.com/pricing`
- [ ] Create test subscription with trial
- [ ] Verify trial-started email received
- [ ] Check database: Subscription status is `TRIALING`
- [ ] Test payment with Stripe test card: `4242 4242 4242 4242`
- [ ] Verify payment-successful email received
- [ ] Check invoice PDF generated: `docker-compose exec backend ls -la /app/storage/invoices`
- [ ] Test plan upgrade
- [ ] Test plan downgrade
- [ ] Test subscription cancellation
- [ ] Verify webhook delivery in Stripe dashboard

### Access Control Testing
- [ ] Create user with FREE plan
- [ ] Verify limited access to features
- [ ] Upgrade to BASIC plan
- [ ] Verify access to basic features
- [ ] Test feature guards with different plan levels

### Monitoring Setup
- [ ] Configure application monitoring (response times, error rates)
- [ ] Set up infrastructure monitoring (CPU, memory, disk)
- [ ] Configure alerts for:
  - [ ] Service downtime
  - [ ] Failed payments
  - [ ] Failed webhook deliveries
  - [ ] Database connection issues
  - [ ] High error rates

### Backup Configuration
- [ ] Set up automated database backups (daily recommended)
- [ ] Set up invoice PDF backups (weekly recommended)
- [ ] Test backup restoration procedure
- [ ] Document backup locations and access procedures

## Troubleshooting

### Backend Won't Start
```bash
# Check logs
docker-compose logs backend

# Common fixes:
# 1. Verify DATABASE_URL is correct
# 2. Run migrations: docker-compose exec backend npx prisma migrate deploy
# 3. Rebuild image: docker-compose build --no-cache backend
```

### Webhooks Not Working
- [ ] Verify webhook URLs are publicly accessible (use ngrok for local testing)
- [ ] Check webhook secrets match environment variables
- [ ] Review webhook logs in payment provider dashboards
- [ ] Check backend logs: `docker-compose logs backend | grep -i webhook`

### Email Not Sending
- [ ] Verify SMTP credentials are correct
- [ ] Check if using app-specific passwords (required for Gmail)
- [ ] Test SMTP connection: `docker-compose exec backend node -e "require('./dist/modules/subscriptions/services/notification.service').NotificationService"`
- [ ] Check firewall allows SMTP traffic (port 587 or 465)

### PDFs Not Generating
```bash
# Check storage directory exists and is writable
docker-compose exec backend ls -la /app/storage/invoices

# Check PDF generation dependencies installed
docker-compose exec backend apk list | grep cairo

# Check logs for errors
docker-compose logs backend | grep -i pdf
```

## Performance Optimization

### Production Checklist
- [ ] Enable HTTP caching headers
- [ ] Use Redis for session storage
- [ ] Enable database connection pooling
- [ ] Set resource limits in docker-compose.prod.yml
- [ ] Enable gzip compression in Nginx
- [ ] Implement CDN for frontend assets
- [ ] Configure database indexes for subscription queries

### Scaling Checklist
- [ ] Load test with expected traffic (use k6 or Artillery)
- [ ] Monitor database query performance
- [ ] Consider horizontal scaling (multiple backend replicas)
- [ ] Set up load balancer (Nginx or Traefik)
- [ ] Consider managed PostgreSQL (AWS RDS, Google Cloud SQL)
- [ ] Consider managed Redis (AWS ElastiCache, Redis Cloud)

## Documentation

- [ ] Document environment setup for team
- [ ] Create runbook for common operations
- [ ] Document backup and restore procedures
- [ ] Create incident response plan
- [ ] Document webhook troubleshooting steps

## Support Resources

- Main Documentation: `SUBSCRIPTION_SYSTEM.md`
- Docker Guide: `DOCKER_DEPLOYMENT.md`
- Implementation Guide: `COMPLETE_IMPLEMENTATION_GUIDE.md`
- Quick Reference: `README_SUBSCRIPTION_SYSTEM.md`

---

**Deployment Status**: ⬜ Not Started | 🟨 In Progress | ✅ Complete

**Last Updated**: {{ date }}
**Deployed By**: {{ name }}
**Environment**: {{ development | production }}
