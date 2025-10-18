# Multi-Environment Setup Guide

## Overview

Your KDS project now has a complete multi-environment setup with automatic CI/CD deployment.

## What Was Created

### 1. Environment Configuration Files
- `.env.development` - Development environment variables (tracked in Git)
- `.env.staging` - Staging environment variables (tracked in Git)
- `.env.production.template` - Production template (NOT tracked, copy to `.env.production`)

### 2. Docker Compose Files
- `docker-compose.dev.yml` - Development environment (port 3001/5174)
- `docker-compose.staging.yml` - Staging environment (port 3002/5175)
- `docker-compose.prod.yml` - Production environment (port 3000/80)

### 3. CI/CD Pipeline
- `.github/workflows/ci-cd.yml` - Updated with three deployment workflows:
  - **Development**: Auto-deploy on push to `develop` branch
  - **Staging**: Auto-deploy on push to `main` branch
  - **Production**: Manual deployment via GitHub Actions

### 4. Deployment Script
- `deploy.sh` - Manual deployment script for all environments
  - Deploy, rollback, status, logs, backup, restart commands

### 5. Documentation
- Updated `README.md` with comprehensive multi-environment documentation
- This guide (`ENVIRONMENT_SETUP_GUIDE.md`)

## Quick Start

### Step 1: Create Develop Branch
```bash
git checkout -b develop
git push -u origin develop
```

### Step 2: Set Up GitHub Secrets

Go to your GitHub repository → Settings → Secrets and Variables → Actions

Add these repository secrets:
```
SERVER_HOST=your.server.ip
SERVER_USERNAME=root
SERVER_SSH_KEY=<paste your private SSH key>

# Environment-specific secrets
POSTGRES_PASSWORD=your_secure_password
JWT_SECRET=your_jwt_secret_64_chars
JWT_REFRESH_SECRET=your_refresh_secret_64_chars

# Payment providers
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# Email
EMAIL_HOST=smtp.your-provider.com
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your_email_password
EMAIL_FROM=noreply@yourdomain.com

# URLs
CORS_ORIGIN=https://yourdomain.com
VITE_STAGING_API_URL=http://your-server:3002/api
VITE_STAGING_WS_URL=ws://your-server:3002
```

### Step 3: Server Setup

SSH into your server and set up the environment:

```bash
# Install Docker if not already installed
sudo apt update
sudo apt install -y docker.io docker-compose git

# Clone repository
cd /opt
sudo git clone <your-repo-url> kds
cd kds

# Create production environment file
sudo cp .env.production.template .env.production
sudo nano .env.production  # Edit with production values

# Create databases
docker-compose -f docker-compose.dev.yml up -d postgres
sleep 10

docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -c "CREATE DATABASE restaurant_pos_dev;"
docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -c "CREATE DATABASE restaurant_pos_staging;"
docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -c "CREATE DATABASE restaurant_pos_prod;"

# Make deploy script executable
chmod +x deploy.sh
```

### Step 4: Commit Changes

```bash
# Add all new files
git add .

# Commit
git commit -m "Setup multi-environment deployment workflow

- Add environment-specific configurations
- Create docker-compose files for dev, staging, and prod
- Update GitHub Actions CI/CD pipeline
- Add deployment script for manual deployments
- Update documentation with environment setup guide"

# Push to both branches
git push origin main
git checkout develop
git merge main
git push origin develop
```

## Usage

### Development Workflow

1. **Create feature branch:**
```bash
git checkout develop
git checkout -b feature/new-feature
```

2. **Make changes and push:**
```bash
git add .
git commit -m "Add new feature"
git push origin feature/new-feature
```

3. **Merge to develop (triggers dev deployment):**
```bash
git checkout develop
git merge feature/new-feature
git push origin develop
# GitHub Actions automatically deploys to development
```

### Staging Deployment

```bash
# Merge develop to main (triggers staging deployment)
git checkout main
git merge develop
git push origin main
# GitHub Actions automatically deploys to staging
```

### Production Deployment

1. Go to GitHub repository
2. Click **Actions** tab
3. Select **CI/CD Pipeline** workflow
4. Click **Run workflow**
5. Select **production** from dropdown
6. Click **Run workflow** button

The workflow will:
- Create database backup
- Deploy to production
- Run migrations
- Perform health check
- Rollback on failure

### Manual Deployment

```bash
# On your server
cd /opt/kds

# Deploy to any environment
./deploy.sh development deploy
./deploy.sh staging deploy
./deploy.sh production deploy

# Other commands
./deploy.sh production status      # Check status
./deploy.sh production logs        # View logs
./deploy.sh production backup      # Create backup
./deploy.sh production rollback    # Rollback
./deploy.sh production restart     # Restart services
```

## Environment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Single VPS Server                       │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────┐│
│  │   Development    │  │     Staging      │  │ Production ││
│  │   Port: 3001     │  │   Port: 3002     │  │ Port: 3000 ││
│  │   Frontend: 5174 │  │  Frontend: 5175  │  │Frontend: 80││
│  └──────────────────┘  └──────────────────┘  └────────────┘│
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │             PostgreSQL (Shared)                          ││
│  │  - restaurant_pos_dev                                    ││
│  │  - restaurant_pos_staging                                ││
│  │  - restaurant_pos_prod                                   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐│
│  │             Redis (Shared)                               ││
│  │  - DB 0: Development                                     ││
│  │  - DB 1: Staging                                         ││
│  │  - DB 2: Production                                      ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

## Branching Strategy

```
feature/xyz ──┐
              ├──→ develop ──────┐
feature/abc ──┘    (dev env)     │
                                 ├──→ main ────→ production
                                 │   (staging)    (manual)
                                 │
                            auto-deploy
```

## CI/CD Pipeline Flow

### On Push to `develop`:
1. Run backend tests
2. Run frontend tests
3. Deploy to development environment
4. Run health check

### On Push to `main`:
1. Run backend tests
2. Run frontend tests
3. Deploy to staging environment
4. Run health check

### Manual Production Deploy:
1. Run backend tests
2. Run frontend tests
3. Create database backup
4. Deploy to production
5. Run migrations
6. Health check
7. Rollback on failure

## Monitoring

### Check Environment Status
```bash
./deploy.sh development status
./deploy.sh staging status
./deploy.sh production status
```

### View Logs
```bash
./deploy.sh development logs
./deploy.sh staging logs
./deploy.sh production logs
```

### Check All Running Containers
```bash
docker ps | grep kds
```

## Troubleshooting

### Deployment Failed

1. Check GitHub Actions logs in the Actions tab
2. SSH into server and check logs:
```bash
cd /opt/kds
./deploy.sh [environment] logs
```

### Health Check Failed

```bash
# Check if services are running
docker-compose -f docker-compose.[env].yml ps

# Check backend logs
docker-compose -f docker-compose.[env].yml logs backend

# Check database connection
docker-compose -f docker-compose.[env].yml exec backend npx prisma db push
```

### Database Migration Failed

```bash
# SSH into server
cd /opt/kds

# Check migration status
docker-compose -f docker-compose.[env].yml exec backend npx prisma migrate status

# Reset database (WARNING: data loss)
docker-compose -f docker-compose.[env].yml exec backend npx prisma migrate reset
```

### Rollback Deployment

```bash
cd /opt/kds
./deploy.sh production rollback
```

## Security Checklist

- [ ] Change default database passwords
- [ ] Generate secure JWT secrets (64+ characters)
- [ ] Set up proper CORS_ORIGIN (no wildcards in production)
- [ ] Use production Stripe/Iyzico keys
- [ ] Configure production email provider
- [ ] Set up SSL/TLS certificates (use Certbot/Let's Encrypt)
- [ ] Enable firewall on server (UFW)
- [ ] Set up log monitoring
- [ ] Schedule regular database backups
- [ ] Review and limit SSH access

## Next Steps

1. **Test Development Deployment:**
   - Push to `develop` branch
   - Verify deployment in GitHub Actions
   - Access http://your-server:5174

2. **Test Staging Deployment:**
   - Merge develop to main
   - Verify deployment in GitHub Actions
   - Access http://your-server:5175

3. **Set Up SSL/TLS:**
   ```bash
   # Install Certbot
   sudo apt install certbot python3-certbot-nginx

   # Get certificate
   sudo certbot --nginx -d yourdomain.com
   ```

4. **Configure Monitoring:**
   - Set up log aggregation (e.g., ELK stack)
   - Configure uptime monitoring (e.g., UptimeRobot)
   - Set up error tracking (e.g., Sentry)

5. **Schedule Backups:**
   ```bash
   # Add cron job for daily backups
   crontab -e

   # Add line:
   0 2 * * * cd /opt/kds && ./deploy.sh production backup
   ```

## Support

For issues:
1. Check GitHub Actions logs
2. Review server logs via `./deploy.sh [env] logs`
3. Check this guide
4. Review README.md for detailed documentation

---

**Congratulations!** Your multi-environment deployment setup is complete. Happy deploying! 🚀
