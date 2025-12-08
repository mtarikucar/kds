# Deployment Guide

Complete guide for deploying the Restaurant POS system to different environments.

## Table of Contents
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Beta Deployment](#beta-deployment)
- [Staging Deployment](#staging-deployment)
- [Production Deployment](#production-deployment)
- [CI/CD Workflows](#cicd-workflows)
- [Monitoring & Health Checks](#monitoring--health-checks)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software
- Docker Engine 20.10+
- Docker Compose 2.0+
- Node.js 18.x
- PostgreSQL 14+
- Redis 7+ (optional but recommended)
- Git

### Required Accounts
- GitHub account (for CI/CD)
- Docker Hub or GitHub Container Registry account
- Domain with SSL certificates
- Server with SSH access

### GitHub Secrets Setup

Configure these secrets in GitHub repository settings:

#### SSH Access
```
SSH_PRIVATE_KEY          # SSH private key for server access
SSH_KNOWN_HOSTS          # SSH known hosts file content
```

#### Server Configuration
```
BETA_SERVER_HOST         # Beta server hostname/IP
BETA_SERVER_USER         # SSH user for beta server

STAGING_SERVER_HOST      # Staging server hostname/IP
STAGING_SERVER_USER      # SSH user for staging server

PRODUCTION_SERVER_HOST   # Production server hostname/IP
PRODUCTION_SERVER_USER   # SSH user for production server
```

#### Database & Services
```
POSTGRES_PASSWORD        # PostgreSQL password
REDIS_PASSWORD           # Redis password
JWT_SECRET               # JWT secret (64+ characters)
JWT_REFRESH_SECRET       # JWT refresh secret (64+ characters)
```

#### Payment Providers
```
# Production Keys
STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET

IYZICO_API_KEY
IYZICO_SECRET_KEY

# Test/Sandbox Keys (for beta/staging)
STRIPE_TEST_SECRET_KEY
STRIPE_TEST_PUBLISHABLE_KEY
STRIPE_TEST_WEBHOOK_SECRET

IYZICO_SANDBOX_API_KEY
IYZICO_SANDBOX_SECRET_KEY
```

#### Email Configuration
```
EMAIL_HOST
EMAIL_PORT
EMAIL_USER
EMAIL_PASSWORD
```

---

## Environment Setup

### 1. Server Preparation

```bash
# Connect to server
ssh user@your-server.com

# Create application directory
sudo mkdir -p /opt/kds-{beta,staging,production}
sudo chown $USER:$USER /opt/kds-*

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

### 2. Clone Repository

```bash
cd /opt/kds-beta
git clone https://github.com/YOUR_USERNAME/kds.git .
git checkout v0.1.0-beta.1  # Or desired version
```

### 3. Configure Environment Variables

```bash
# Copy template
cp backend/.env.production.template backend/.env

# Edit environment file
nano backend/.env
```

Fill in all required values from the template.

---

## Beta Deployment

### Automated Deployment (Recommended)

Beta deployment is triggered automatically when pushing a beta tag:

```bash
# Tag a new beta release
git tag -a v0.1.0-beta.2 -m "Beta release v0.1.0-beta.2"
git push origin v0.1.0-beta.2

# Or use workflow dispatch from GitHub Actions UI
```

The deployment workflow will:
1. Run tests
2. Build Docker images
3. Push to GitHub Container Registry
4. Deploy to beta server
5. Run database migrations
6. Perform health checks
7. Create GitHub pre-release

### Manual Deployment

```bash
# On beta server
cd /opt/kds-beta

# Pull latest beta tag
git fetch --tags
git checkout v0.1.0-beta.1

# Set environment
export IMAGE_TAG=v0.1.0-beta.1
export GITHUB_REPOSITORY=YOUR_USERNAME/kds

# Pull Docker images
docker-compose -f docker-compose.beta.yml pull

# Backup database
./scripts/backup-database.sh beta

# Deploy
docker-compose -f docker-compose.beta.yml up -d

# Run migrations
docker-compose -f docker-compose.beta.yml exec backend npx prisma migrate deploy

# Verify deployment
./scripts/verify-deployment.sh beta https://beta.yourapp.com
```

---

## Staging Deployment

Staging deployment is triggered automatically on pushes to `main` branch.

### Manual Deployment

```bash
cd /opt/kds-staging

# Pull latest
git pull origin main

# Deploy
docker-compose -f docker-compose.staging.yml down
docker-compose -f docker-compose.staging.yml build
docker-compose -f docker-compose.staging.yml up -d

# Migrations
docker-compose -f docker-compose.staging.yml exec backend npx prisma migrate deploy

# Verify
./scripts/verify-deployment.sh staging https://staging.yourapp.com
```

---

## Production Deployment

Production deployment requires manual workflow dispatch for safety.

### Steps

1. **Prepare Release**
   ```bash
   # Ensure all tests pass
   git checkout main
   git pull origin main

   # Tag production release
   git tag -a v1.0.0 -m "Production release v1.0.0"
   git push origin v1.0.0
   ```

2. **Deploy via GitHub Actions**
   - Go to GitHub Actions → "Deploy to Production"
   - Click "Run workflow"
   - Enter version (e.g., v1.0.0)
   - Confirm deployment

3. **Post-Deployment Verification**
   ```bash
   # SSH to production server
   ssh user@production-server.com

   # Verify deployment
   cd /opt/kds
   ./scripts/verify-deployment.sh production https://yourapp.com

   # Check logs
   docker-compose -f docker-compose.prod.yml logs -f --tail=100
   ```

4. **Rollback (if needed)**
   ```bash
   # Automated rollback
   ./scripts/rollback-deployment.sh

   # Or manual rollback
   git checkout <previous-tag>
   docker-compose -f docker-compose.prod.yml up -d --no-deps backend frontend
   ```

---

## CI/CD Workflows

### Available Workflows

#### 1. **Test & Lint** (`test.yml`)
- Runs on: All branches, PRs to main/develop
- Actions: Lint, test, build
- Services: PostgreSQL, Redis

#### 2. **Deploy Beta** (`deploy-beta.yml`)
- Triggers: Push beta tags (`v*-beta.*`)
- Actions:
  - Run tests
  - Build & push Docker images to GHCR
  - Deploy to beta server
  - Run migrations
  - Health checks
  - Create pre-release

#### 3. **Deploy Staging** (`deploy-staging.yml`)
- Triggers: Push to `main` branch
- Actions:
  - Run tests
  - Deploy to staging server
  - Run migrations
  - Notify deployment status

#### 4. **Deploy Production** (`deploy-production.yml`)
- Triggers: Manual workflow dispatch only
- Actions:
  - Run tests
  - Backup database
  - Deploy with zero-downtime
  - Run migrations
  - Health checks
  - Create GitHub release
  - Automatic rollback on failure

#### 5. **Health Check** (`health-check.yml`)
- Triggers: Cron schedule (every 30 min), manual
- Actions:
  - Check API health endpoints
  - Verify database connections
  - Monitor response times
  - Create alerts on failure

### Workflow Status Badges

Add to your README.md:

```markdown
![Tests](https://github.com/YOUR_USERNAME/kds/actions/workflows/test.yml/badge.svg)
![Beta Deployment](https://github.com/YOUR_USERNAME/kds/actions/workflows/deploy-beta.yml/badge.svg)
![Health Check](https://github.com/YOUR_USERNAME/kds/actions/workflows/health-check.yml/badge.svg)
```

---

## Monitoring & Health Checks

### Automated Health Checks

Health checks run every 30 minutes automatically:
- API health endpoint
- Database connectivity
- Redis connectivity
- Response time monitoring
- Critical endpoint availability

### Manual Health Check

```bash
# Run verification script
./scripts/verify-deployment.sh <environment> <base_url>

# Examples
./scripts/verify-deployment.sh beta https://beta.yourapp.com
./scripts/verify-deployment.sh production https://yourapp.com
```

### Health Endpoints

```
GET /api/health
{
  "status": "healthy",
  "database": "healthy",
  "redis": "healthy",
  "uptime": 123456,
  "version": "0.1.0-beta.1"
}
```

### Monitoring Logs

```bash
# View all logs
docker-compose -f docker-compose.<env>.yml logs -f

# Backend only
docker-compose -f docker-compose.<env>.yml logs -f backend

# Last 100 lines
docker-compose -f docker-compose.<env>.yml logs --tail=100
```

---

## Troubleshooting

### Common Issues

#### 1. Database Connection Failed
```bash
# Check PostgreSQL status
docker-compose ps postgres

# Check logs
docker-compose logs postgres

# Restart database
docker-compose restart postgres
```

#### 2. Migration Errors
```bash
# Reset migrations (development only!)
docker-compose exec backend npx prisma migrate reset

# Deploy migrations
docker-compose exec backend npx prisma migrate deploy
```

#### 3. Container Won't Start
```bash
# Check container status
docker-compose ps

# Check logs
docker-compose logs <service-name>

# Rebuild container
docker-compose build <service-name>
docker-compose up -d <service-name>
```

#### 4. High Response Time
```bash
# Check system resources
docker stats

# Check database performance
docker-compose exec postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"

# Check Redis
docker-compose exec redis redis-cli INFO stats
```

### Rollback Procedure

```bash
# Automatic rollback (recommended)
./scripts/rollback-deployment.sh

# Manual rollback
git checkout <previous-stable-tag>
docker-compose down
docker-compose up -d
./scripts/verify-deployment.sh
```

### Emergency Contacts

- **DevOps Team**: devops@yourcompany.com
- **On-call Engineer**: See PagerDuty rotation
- **GitHub Issues**: https://github.com/YOUR_USERNAME/kds/issues

---

## Security Checklist

Before production deployment:

- [ ] All secrets rotated and secure
- [ ] SSL/TLS certificates configured
- [ ] Firewall rules in place
- [ ] Database backups automated
- [ ] Monitoring and alerting configured
- [ ] Rate limiting enabled
- [ ] CORS properly configured
- [ ] Environment variables validated
- [ ] Security headers configured
- [ ] Dependencies up to date
- [ ] Penetration testing completed
- [ ] Disaster recovery plan documented

---

## Performance Optimization

### Database
- Enable connection pooling
- Configure proper indexes
- Regular VACUUM and ANALYZE
- Monitor slow queries

### Redis
- Configure appropriate eviction policy
- Monitor memory usage
- Enable persistence if needed

### Docker
- Use multi-stage builds
- Optimize image layers
- Configure resource limits
- Enable health checks

### Application
- Enable compression
- Configure caching
- Optimize API queries
- Monitor memory leaks

---

## Additional Resources

- [Environment Variables Guide](.env.production.template)
- [Database Backup Script](../scripts/backup-database.sh)
- [Rollback Script](../scripts/rollback-deployment.sh)
- [Docker Compose Files](../docker-compose.*.yml)
- [GitHub Actions Workflows](../.github/workflows/)

---

**Last Updated:** 2025-10-21
**Version:** 0.1.0-beta.1
