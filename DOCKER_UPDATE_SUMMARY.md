# Docker Configuration Update Summary

## Overview

All Docker configurations have been successfully updated to support the complete subscription system with payment processing, email notifications, and invoice PDF generation.

## What Was Updated

### 1. Backend Dockerfile (`backend/Dockerfile`)

**Changes:**
- ✅ Added PDF generation system dependencies (cairo, pango, jpeg, etc.)
- ✅ Created storage directories for invoice PDFs
- ✅ Created directories for email templates
- ✅ Set proper file permissions for production
- ✅ Multi-stage build (development and production targets)

**Dependencies Added:**
```dockerfile
# Development stage
RUN apk add --no-cache \
    openssl \
    cairo-dev \
    pango-dev \
    jpeg-dev \
    giflib-dev \
    librsvg-dev \
    pixman-dev \
    python3 \
    make \
    g++

# Production stage (runtime only)
RUN apk add --no-cache \
    openssl \
    cairo \
    pango \
    jpeg \
    giflib \
    librsvg \
    pixman
```

**Directories Created:**
- `/app/storage/invoices` - For invoice PDF storage
- `/app/src/modules/subscriptions/templates/emails` - For email templates

### 2. Development Docker Compose (`docker-compose.yml`)

**Environment Variables Added:**

```yaml
# Stripe Configuration
STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY:-sk_test_placeholder}
STRIPE_PUBLISHABLE_KEY: ${STRIPE_PUBLISHABLE_KEY:-pk_test_placeholder}
STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET:-whsec_placeholder}

# Iyzico Configuration
IYZICO_API_KEY: ${IYZICO_API_KEY:-placeholder}
IYZICO_SECRET_KEY: ${IYZICO_SECRET_KEY:-placeholder}
IYZICO_BASE_URL: ${IYZICO_BASE_URL:-https://sandbox-api.iyzipay.com}

# Email Configuration
EMAIL_HOST: ${EMAIL_HOST:-smtp.gmail.com}
EMAIL_PORT: ${EMAIL_PORT:-587}
EMAIL_SECURE: ${EMAIL_SECURE:-false}
EMAIL_USER: ${EMAIL_USER:-}
EMAIL_PASSWORD: ${EMAIL_PASSWORD:-}
EMAIL_FROM: ${EMAIL_FROM:-noreply@restaurant-pos.com}

# Subscription Settings
DEFAULT_TRIAL_DAYS: ${DEFAULT_TRIAL_DAYS:-14}
TRIAL_REMINDER_DAYS: ${TRIAL_REMINDER_DAYS:-3}
```

**Volume Mounts Added:**
- Backend: `./backend/storage:/app/storage` - For local invoice access during development

**Frontend Updates:**
- Added `VITE_STRIPE_PUBLISHABLE_KEY` environment variable

### 3. Production Docker Compose (`docker-compose.prod.yml`)

**Key Differences from Development:**

- ✅ Uses production payment provider URLs
- ✅ Production Iyzico URL: `https://api.iyzipay.com`
- ✅ Requires all environment variables (no defaults)
- ✅ Named volume for invoice storage (persistent)
- ✅ Frontend build with ARG support for environment variables
- ✅ Health checks for all services
- ✅ Restart policy: `always`

**Volumes:**
```yaml
volumes:
  postgres_data:      # PostgreSQL data
  redis_data:         # Redis cache
  invoice_storage:    # Invoice PDFs (persistent)
```

### 4. Frontend Dockerfile (`frontend/Dockerfile`)

**Build Arguments Added:**
```dockerfile
ARG VITE_API_URL
ARG VITE_STRIPE_PUBLISHABLE_KEY

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_STRIPE_PUBLISHABLE_KEY=$VITE_STRIPE_PUBLISHABLE_KEY
```

These allow passing environment variables at build time for production deployments.

### 5. New Files Created

#### `.env.docker` - Environment Template
Complete environment variable template with:
- Database configuration
- JWT secrets
- Stripe API keys with links to dashboard
- Iyzico credentials
- Email SMTP settings
- Subscription settings
- Frontend configuration
- Production deployment notes

#### `DOCKER_DEPLOYMENT.md` - Deployment Guide
Comprehensive guide covering:
- Prerequisites and system requirements
- Quick start for development
- Production deployment steps
- Webhook configuration
- Service management commands
- Database operations
- Backup and restore procedures
- Troubleshooting guide
- Security best practices
- Performance optimization
- Scaling strategies
- Monitoring setup

#### `DEPLOYMENT_CHECKLIST.md` - Deployment Checklist
Step-by-step checklist for:
- Pre-deployment verification
- Environment configuration
- Database setup
- Payment provider configuration
- Email service testing
- Storage verification
- Development deployment
- Production deployment
- Post-deployment verification
- Functional testing
- Access control testing
- Monitoring setup
- Backup configuration

#### `quick-start.sh` - Automated Setup Script
Bash script that:
- Checks Docker and Docker Compose installation
- Creates .env file from template
- Starts all services
- Runs Prisma migrations
- Seeds subscription plans
- Provides helpful next steps

## How to Use

### Development Environment

#### Option 1: Quick Start (Recommended)
```bash
# Run automated setup script
./quick-start.sh

# Follow the prompts to configure your environment
```

#### Option 2: Manual Setup
```bash
# 1. Copy environment file
cp .env.docker .env

# 2. Edit .env with your API keys
nano .env

# 3. Start services
docker-compose up -d

# 4. Run migrations
docker-compose exec backend npx prisma migrate deploy

# 5. Seed subscription plans
docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts

# 6. View logs
docker-compose logs -f
```

### Production Environment

```bash
# 1. Create production environment
cp .env.docker .env.production

# 2. Update with production values
nano .env.production

# 3. Build production images
docker-compose -f docker-compose.prod.yml build

# 4. Start production services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# 5. Run migrations
docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# 6. Seed plans
docker-compose -f docker-compose.prod.yml exec backend npx ts-node prisma/seed-subscriptions.ts
```

## Service Access Points

### Development
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

### Production
- Frontend: http://localhost:80 (configure reverse proxy with SSL)
- Backend API: http://localhost:3000 (configure reverse proxy with SSL)
- PostgreSQL: Internal only (don't expose)
- Redis: Internal only (don't expose)

## Required Configuration

### Before Starting Services

1. **Stripe API Keys** (Get from https://dashboard.stripe.com/apikeys)
   - `STRIPE_SECRET_KEY` - For backend payment processing
   - `STRIPE_PUBLISHABLE_KEY` - For frontend Stripe Elements
   - `STRIPE_WEBHOOK_SECRET` - For webhook verification (configure after deployment)

2. **Iyzico Credentials** (Get from merchant panel)
   - `IYZICO_API_KEY`
   - `IYZICO_SECRET_KEY`
   - `IYZICO_BASE_URL` - Sandbox for testing, production for live

3. **Email SMTP Settings**
   - `EMAIL_HOST` - SMTP server (e.g., smtp.gmail.com)
   - `EMAIL_PORT` - Usually 587 for TLS
   - `EMAIL_USER` - Email account
   - `EMAIL_PASSWORD` - App-specific password (for Gmail)
   - `EMAIL_FROM` - Sender address

4. **Security**
   - `POSTGRES_PASSWORD` - Strong password for database
   - `JWT_SECRET` - Random string for JWT signing
   - `JWT_REFRESH_SECRET` - Random string for refresh tokens

### After Deployment

1. **Configure Stripe Webhooks**
   - Go to https://dashboard.stripe.com/webhooks
   - Add endpoint: `https://yourdomain.com/webhooks/stripe`
   - Select events: payment_intent.*, customer.subscription.*, invoice.*
   - Copy webhook secret to `STRIPE_WEBHOOK_SECRET`
   - Restart backend service

2. **Configure Iyzico Callbacks**
   - Configure in Iyzico merchant panel
   - Set callback URL: `https://yourdomain.com/webhooks/iyzico`

## Verification Steps

### 1. Check Services Running
```bash
docker-compose ps
```
All services should show "Up" and "healthy" status.

### 2. Check Backend Logs
```bash
docker-compose logs backend | head -50
```
Should show successful startup without errors.

### 3. Check Database Connection
```bash
docker-compose exec backend npx prisma studio
```
Should open Prisma Studio on http://localhost:5555

### 4. Check Storage Directories
```bash
docker-compose exec backend ls -la /app/storage/invoices
```
Directory should exist and be writable.

### 5. Check Email Templates
```bash
docker-compose exec backend ls -la /app/src/modules/subscriptions/templates/emails
```
Should show email template files (.hbs).

### 6. Test Payment Provider Connection
Check backend logs for any payment provider initialization errors.

## Troubleshooting

### Backend Won't Start
```bash
# Check logs for errors
docker-compose logs backend

# Common fixes:
# 1. Verify DATABASE_URL is correct
# 2. Ensure migrations are applied
docker-compose exec backend npx prisma migrate deploy

# 3. Rebuild without cache
docker-compose build --no-cache backend
```

### Frontend Build Fails (Production)
```bash
# Verify environment variables are set
docker-compose -f docker-compose.prod.yml config

# Rebuild with verbose output
docker-compose -f docker-compose.prod.yml build --no-cache --progress=plain frontend
```

### PDF Generation Fails
```bash
# Check if dependencies installed
docker-compose exec backend apk list | grep cairo

# Check storage permissions
docker-compose exec backend ls -la /app/storage

# Check logs for PDF errors
docker-compose logs backend | grep -i pdf
```

### Email Not Sending
```bash
# Check SMTP configuration in .env
cat .env | grep EMAIL

# Check backend logs for email errors
docker-compose logs backend | grep -i email

# Test with temporary debug output
docker-compose exec backend node -e "console.log(process.env.EMAIL_HOST)"
```

### Webhooks Not Working
- Verify webhook URLs are publicly accessible (use ngrok for local testing)
- Check webhook secrets match environment variables
- Review webhook delivery logs in Stripe dashboard
- Check backend logs for webhook processing errors

## Performance Considerations

### Resource Limits (Production)

Add to `docker-compose.prod.yml`:

```yaml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### Scaling Backend

```yaml
services:
  backend:
    deploy:
      replicas: 3
```

Then add a load balancer (Nginx or Traefik) in front.

## Security Checklist

- [ ] Use strong passwords for database
- [ ] Use production payment provider keys
- [ ] Configure SSL/TLS (Let's Encrypt)
- [ ] Don't expose PostgreSQL/Redis ports externally in production
- [ ] Use Docker secrets instead of environment variables for sensitive data
- [ ] Enable firewall rules
- [ ] Set up log aggregation
- [ ] Configure error monitoring (Sentry)
- [ ] Regular security updates (`docker-compose pull`)

## Backup Strategy

### Database Backup
```bash
# Create backup
docker-compose exec postgres pg_dump -U postgres restaurant_pos > backup_$(date +%Y%m%d).sql

# Restore backup
docker-compose exec -T postgres psql -U postgres restaurant_pos < backup_20250101.sql
```

### Invoice PDFs Backup
```bash
# Create backup (development)
tar czf invoices-backup-$(date +%Y%m%d).tar.gz backend/storage/invoices

# Create backup (production volume)
docker run --rm -v kds_invoice_storage:/data -v $(pwd):/backup alpine \
  tar czf /backup/invoices-backup-$(date +%Y%m%d).tar.gz -C /data .
```

### Automated Backup Script
Create `backup.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec postgres pg_dump -U postgres restaurant_pos > backup_$DATE.sql
tar czf invoices_backup_$DATE.tar.gz backend/storage/invoices
echo "Backup completed: $DATE"
```

Schedule with cron:
```bash
0 2 * * * /path/to/backup.sh
```

## Monitoring

### View Resource Usage
```bash
docker stats
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f backend

# Last 100 lines
docker-compose logs --tail=100 backend

# Follow with timestamp
docker-compose logs -f -t backend
```

### Health Checks
```bash
# Check service health
docker-compose ps

# Detailed inspect
docker inspect kds_backend | grep -A 10 Health
```

## Next Steps

1. ✅ Docker configuration is complete
2. ⬜ Configure payment provider API keys
3. ⬜ Set up email SMTP service
4. ⬜ Deploy to development environment
5. ⬜ Test subscription functionality
6. ⬜ Configure webhooks
7. ⬜ Deploy to production
8. ⬜ Set up monitoring and backups

## Additional Resources

- **Main Documentation**: `README.md`
- **Subscription System**: `SUBSCRIPTION_SYSTEM.md`
- **Implementation Guide**: `COMPLETE_IMPLEMENTATION_GUIDE.md`
- **Quick Reference**: `README_SUBSCRIPTION_SYSTEM.md`
- **Deployment Checklist**: `DEPLOYMENT_CHECKLIST.md`
- **Docker Guide**: `DOCKER_DEPLOYMENT.md`

## Support

For issues:
1. Check logs: `docker-compose logs`
2. Verify environment: `docker-compose config`
3. Check service health: `docker-compose ps`
4. Review documentation in this repository

---

**Status**: ✅ Docker configuration complete and ready for deployment
**Updated**: 2025-10-10
**Version**: 1.0.0
