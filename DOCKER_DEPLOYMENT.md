# Docker Deployment Guide

## Overview

This guide covers deploying the Restaurant POS system with the complete subscription functionality using Docker.

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB RAM
- At least 10GB disk space

## Quick Start (Development)

### 1. Environment Setup

```bash
# Copy the example environment file
cp .env.docker .env

# Edit .env and add your actual values
nano .env
```

**Required Configuration**:
- Database credentials
- JWT secrets
- Stripe API keys (get from https://dashboard.stripe.com)
- Iyzico credentials (if targeting Turkish market)
- Email SMTP settings

### 2. Start Services

```bash
# Start all services in development mode
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 3. Initialize Database

```bash
# Run Prisma migrations
docker-compose exec backend npx prisma migrate deploy

# Seed subscription plans
docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts
```

### 4. Access Application

- **Frontend**: http://localhost:5173
- **Backend API**: http://localhost:3000
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Production Deployment

### 1. Environment Configuration

```bash
# Create production environment file
cp .env.docker .env.production

# Update with production values
nano .env.production
```

**Production Checklist**:
- ✅ Use strong passwords for database
- ✅ Use production Stripe keys (sk_live_...)
- ✅ Use production Iyzico URL (https://api.iyzipay.com)
- ✅ Configure production email service
- ✅ Set proper CORS_ORIGIN
- ✅ Use strong JWT secrets
- ✅ Set VITE_API_URL to production domain

### 2. Build and Deploy

```bash
# Build production images
docker-compose -f docker-compose.prod.yml build

# Start production services
docker-compose -f docker-compose.prod.yml --env-file .env.production up -d

# Run database migrations
docker-compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy

# Seed subscription plans
docker-compose -f docker-compose.prod.yml exec backend npx ts-node prisma/seed-subscriptions.ts
```

### 3. Configure Webhooks

After deployment, configure webhooks for payment providers:

**Stripe Webhooks**:
1. Go to https://dashboard.stripe.com/webhooks
2. Add endpoint: `https://yourdomain.com/webhooks/stripe`
3. Select events:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Copy webhook secret to `.env.production` as `STRIPE_WEBHOOK_SECRET`

**Iyzico Callbacks**:
1. Configure in Iyzico merchant panel
2. Set callback URL: `https://yourdomain.com/webhooks/iyzico`

## Docker Services

### Backend Service

**Includes**:
- NestJS API server
- Prisma ORM with PostgreSQL
- Stripe & Iyzico payment integrations
- Email service (Nodemailer)
- PDF generation (PDFKit)
- Scheduled tasks (Cron jobs)
- Webhook handlers

**Volumes**:
- `./backend/storage:/app/storage` - Invoice PDFs storage

**Health Check**: Pings `/api` endpoint every 30s

### Frontend Service

**Includes**:
- React + Vite application
- Nginx web server (production)
- Stripe Elements integration

**Build Args**:
- `VITE_API_URL` - Backend API URL
- `VITE_STRIPE_PUBLISHABLE_KEY` - Stripe publishable key

### Database Services

**PostgreSQL**:
- Version: 15-alpine
- Default database: `restaurant_pos`
- Persistent volume: `postgres_data`

**Redis**:
- Version: 7-alpine
- Used for caching and sessions
- Persistent volume: `redis_data`

## Storage Volumes

```yaml
volumes:
  postgres_data:        # PostgreSQL data
  redis_data:          # Redis cache
  invoice_storage:     # Invoice PDFs (production)
```

## Networking

All services are on the same Docker network and can communicate using service names:

- Backend connects to `postgres:5432`
- Backend connects to `redis:6379`
- Frontend connects to `backend:3000`

## Useful Commands

### Service Management

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Restart a service
docker-compose restart backend

# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Execute command in container
docker-compose exec backend sh
docker-compose exec backend npm run prisma:studio
```

### Database Operations

```bash
# Create migration
docker-compose exec backend npx prisma migrate dev --name migration_name

# Apply migrations
docker-compose exec backend npx prisma migrate deploy

# Generate Prisma client
docker-compose exec backend npx prisma generate

# Open Prisma Studio
docker-compose exec backend npx prisma studio
```

### Backup & Restore

```bash
# Backup database
docker-compose exec postgres pg_dump -U postgres restaurant_pos > backup.sql

# Restore database
docker-compose exec -T postgres psql -U postgres restaurant_pos < backup.sql

# Backup invoice PDFs
docker run --rm -v kds_invoice_storage:/data -v $(pwd):/backup alpine tar czf /backup/invoices-backup.tar.gz -C /data .
```

### Monitoring

```bash
# View resource usage
docker stats

# Check service health
docker-compose ps

# View container logs
docker-compose logs --tail=100 -f backend
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
docker-compose logs backend

# Common issues:
# 1. Database connection - verify DATABASE_URL
# 2. Missing migrations - run prisma migrate deploy
# 3. Missing dependencies - rebuild image
docker-compose build --no-cache backend
```

### Frontend build fails

```bash
# Check environment variables
docker-compose config

# Rebuild without cache
docker-compose build --no-cache frontend
```

### Webhooks not working

1. Verify webhook URLs are publicly accessible
2. Check webhook secrets match environment variables
3. Review webhook logs in payment provider dashboards
4. Check backend logs for webhook errors

### Email not sending

1. Verify SMTP credentials
2. Check if using app-specific passwords (Gmail)
3. Verify EMAIL_HOST and EMAIL_PORT are correct
4. Check firewall/network allows SMTP traffic

### PDFs not generating

```bash
# Check if storage directory exists and is writable
docker-compose exec backend ls -la /app/storage/invoices

# Check logs for PDF generation errors
docker-compose logs backend | grep -i pdf
```

## Production Best Practices

### Security

1. **Use secrets management**:
   ```bash
   # Use Docker secrets instead of environment variables
   docker secret create stripe_key stripe_key.txt
   ```

2. **Enable SSL/TLS**:
   - Use reverse proxy (Nginx, Traefik)
   - Configure SSL certificates (Let's Encrypt)

3. **Restrict network access**:
   - Don't expose PostgreSQL/Redis ports externally
   - Use internal Docker networks

### Performance

1. **Resource Limits**:
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

2. **Enable caching**:
   - Use Redis for session storage
   - Enable HTTP caching headers

3. **Database optimization**:
   - Regular backups
   - Connection pooling
   - Query optimization

### Monitoring

1. **Application Monitoring**:
   - Set up error tracking (Sentry)
   - Configure logging aggregation
   - Monitor API response times

2. **Infrastructure Monitoring**:
   - Use Prometheus + Grafana
   - Monitor Docker metrics
   - Set up alerts for service downtime

### Backup Strategy

1. **Automated Backups**:
   ```bash
   # Create backup script
   #!/bin/bash
   DATE=$(date +%Y%m%d_%H%M%S)
   docker-compose exec postgres pg_dump -U postgres restaurant_pos > backup_$DATE.sql
   ```

2. **Backup Schedule**:
   - Database: Daily
   - Invoice PDFs: Weekly
   - Configuration: On changes

## Scaling

### Horizontal Scaling

```yaml
services:
  backend:
    deploy:
      replicas: 3
    depends_on:
      - postgres
      - redis
```

### Load Balancing

Use Nginx or Traefik as load balancer:

```yaml
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx-lb.conf:/etc/nginx/nginx.conf
```

## Support

For issues or questions:
1. Check logs: `docker-compose logs`
2. Review environment variables: `docker-compose config`
3. Verify services health: `docker-compose ps`
4. Consult main documentation: `SUBSCRIPTION_SYSTEM.md`

## Updates

To update to latest version:

```bash
# Pull latest code
git pull

# Rebuild images
docker-compose build --pull

# Restart services
docker-compose up -d

# Run any new migrations
docker-compose exec backend npx prisma migrate deploy
```

---

**Deployment Checklist**:
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Subscription plans seeded
- [ ] Payment provider webhooks configured
- [ ] Email service tested
- [ ] SSL certificates installed
- [ ] Backups configured
- [ ] Monitoring set up
- [ ] Load testing completed
- [ ] Documentation updated
