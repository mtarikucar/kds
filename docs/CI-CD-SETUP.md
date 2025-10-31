# CI/CD Setup Guide

Complete guide for setting up and using the CI/CD pipeline for the Restaurant POS system.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Prerequisites](#prerequisites)
4. [GitHub Secrets Configuration](#github-secrets-configuration)
5. [Workflows](#workflows)
6. [Blue-Green Deployment](#blue-green-deployment)
7. [PR Staging Environments](#pr-staging-environments)
8. [Manual Operations](#manual-operations)
9. [Troubleshooting](#troubleshooting)

## Overview

Our CI/CD pipeline provides:
- ✅ Automated testing (unit tests, linting, build verification)
- ✅ Blue-Green deployments for zero-downtime updates
- ✅ Isolated PR staging environments for testing
- ✅ Automatic database backups before deployments
- ✅ Health checks and automatic rollback on failure
- ✅ Release management with semantic versioning

## Architecture

### Deployment Strategy

The system uses **Blue-Green Deployment** for production:
- Two identical environments (blue and green)
- Only one is active at a time (serves production traffic)
- Deploy to inactive environment
- Switch traffic after successful health checks
- Rollback instantly by switching back

### Environments

| Environment | Port | Purpose | URL |
|------------|------|---------|-----|
| Production Blue | 3000 | Active production | https://hummytummy.com |
| Production Green | 3001 | Inactive (for deployment) | - |
| Staging | 3002 | Pre-production testing | http://38.242.233.166:3002 |
| PR Staging | 8000+ | Isolated PR testing | http://38.242.233.166:8xxx |

### Container Naming

- **Blue Environment**: `kds_backend_blue`, `kds_frontend_blue`
- **Green Environment**: `kds_backend_green`, `kds_frontend_green`
- **Shared Services**: `kds_postgres_prod`, `kds_redis_prod`

## Prerequisites

### Server Requirements

- Ubuntu 20.04+ or similar Linux distribution
- Docker and Docker Compose installed
- Nginx installed and configured
- SSH access with key-based authentication
- 4GB+ RAM, 20GB+ disk space

### Local Requirements

- Git configured with SSH keys
- GitHub account with repository access
- Node.js 18.x (for local development)

## GitHub Secrets Configuration

Configure the following secrets in your GitHub repository:

### Required Secrets

Go to: `Settings` → `Secrets and variables` → `Actions` → `New repository secret`

```
SSH_PRIVATE_KEY          # Private SSH key for server access
SSH_KNOWN_HOSTS          # Server's SSH host key
POSTGRES_PASSWORD        # Production database password
JWT_SECRET               # JWT signing secret
JWT_REFRESH_SECRET       # JWT refresh token secret
```

### Optional Secrets (for payments/email)

```
STRIPE_SECRET_KEY        # Stripe secret key
STRIPE_PUBLISHABLE_KEY   # Stripe publishable key
STRIPE_WEBHOOK_SECRET    # Stripe webhook secret
IYZICO_API_KEY          # Iyzico API key
IYZICO_SECRET_KEY       # Iyzico secret key
EMAIL_HOST              # SMTP host
EMAIL_PORT              # SMTP port
EMAIL_USER              # SMTP username
EMAIL_PASSWORD          # SMTP password
```

### How to Get SSH Keys

```bash
# On your server
ssh-keygen -t ed25519 -C "github-actions"

# Get the private key (add to GitHub secret: SSH_PRIVATE_KEY)
cat ~/.ssh/id_ed25519

# Get the public key (add to server's authorized_keys)
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys

# Get known_hosts entry (add to GitHub secret: SSH_KNOWN_HOSTS)
ssh-keyscan -H 38.242.233.166
```

## Workflows

### 1. Test Workflow (`test.yml`)

**Trigger:** Every push and pull request

**Purpose:** Run tests, linting, and build verification

**Steps:**
1. Backend tests (Jest)
2. Frontend tests (Vitest)
3. Linting (ESLint)
4. Build verification

**Services:**
- PostgreSQL (for backend tests)
- Redis (for caching tests)

### 2. Release Deployment (`release-deploy.yml`)

**Trigger:** Push a tag matching `v*.*.*` (e.g., `v1.0.0`)

**Purpose:** Deploy to production with Blue-Green strategy

**Steps:**
1. Run tests
2. Build Docker images
3. Create database backup
4. Transfer images to server
5. Deploy to inactive environment
6. Run migrations
7. Health check
8. Switch traffic
9. Create GitHub release

**Example:**
```bash
# Create and push a release tag
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

### 3. PR Staging (`pr-staging.yml`)

**Trigger:** Pull requests to `main` or `develop`

**Purpose:** Create isolated staging environment for PR testing

**Steps:**
1. Run tests
2. Setup isolated environment (unique ports)
3. Deploy PR code
4. Create database instance
5. Comment on PR with URLs
6. Auto-cleanup when PR closes

**Features:**
- Each PR gets unique ports (8000+PR_NUMBER)
- Separate database per PR
- Automatic cleanup on PR close
- Comment updates on each push

### 4. CI/CD Pipeline (`ci-cd.yml`)

**Trigger:** Push to `main` or `develop`

**Purpose:** Comprehensive CI/CD with auto-deployment

**Environments:**
- `develop` branch → auto-deploy to development
- `main` branch → auto-deploy to staging
- Production requires manual trigger

## Blue-Green Deployment

### How It Works

1. **Current State:** Blue environment is active (port 3000)
2. **Deploy:** Build and start green environment (port 3001)
3. **Verify:** Run health checks on green
4. **Switch:** Update Nginx to point to green
5. **Rollback:** Blue remains ready for instant rollback

### Manual Blue-Green Deploy

```bash
# SSH to server
ssh root@38.242.233.166

# Navigate to project
cd /root/kds

# Deploy to inactive environment
./scripts/blue-green-deploy.sh deploy

# Check status
./scripts/blue-green-deploy.sh status

# Rollback if needed
./scripts/blue-green-deploy.sh rollback
```

### Nginx Configuration

Nginx is configured to automatically route to the active environment:
- Blue: `proxy_pass http://localhost:3000`
- Green: `proxy_pass http://localhost:3001`

The deployment script automatically updates Nginx configuration.

## PR Staging Environments

### Creating PR Staging

PR staging environments are **automatically created** when you open a PR:

```bash
# Create a feature branch
git checkout -b feature/new-feature

# Make changes and commit
git add .
git commit -m "Add new feature"

# Push and create PR
git push origin feature/new-feature
# Open PR on GitHub
```

GitHub Actions will:
1. Run tests
2. Create isolated environment
3. Comment on PR with URLs

### Manual PR Staging Setup

```bash
# SSH to server
ssh root@38.242.233.166

# Setup PR #123
cd /root/kds
./scripts/pr-staging-setup.sh 123 feature/new-feature

# Access URLs (replace 123 with your PR number)
# Frontend: http://38.242.233.166:8223
# Backend: http://38.242.233.166:8123
```

### Cleanup PR Staging

```bash
# Automatic: Happens when PR is closed

# Manual cleanup
./scripts/pr-staging-cleanup.sh 123
```

## Manual Operations

### Database Backup

```bash
# Create backup
./scripts/backup-database.sh

# Backups are stored in /root/kds/backups/database/
# Format: backup_YYYYMMDD_HHMMSS.sql.gz
# Retention: 7 days
```

### Health Check

```bash
# Comprehensive health check
./scripts/health-check.sh

# Individual checks
./scripts/health-check.sh api
./scripts/health-check.sh database
./scripts/health-check.sh redis
./scripts/health-check.sh ssl
```

### Rollback Deployment

```bash
# Automatic: Happens on deployment failure

# Manual rollback
./scripts/rollback-deployment.sh

# Will restore from latest backup
```

### View Logs

```bash
# All containers
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f backend-blue

# Last 100 lines
docker compose -f docker-compose.prod.yml logs --tail=100 backend-blue
```

### Restart Services

```bash
# Restart without rebuilding
docker compose -f docker-compose.prod.yml restart backend-blue

# Restart with rebuild
docker compose -f docker-compose.prod.yml up -d --build backend-blue
```

## Troubleshooting

### Deployment Fails

**Check logs:**
```bash
docker compose -f docker-compose.prod.yml logs backend-blue
```

**Check container status:**
```bash
docker ps -a | grep kds
```

**Run health check:**
```bash
./scripts/health-check.sh
```

### Database Migration Fails

**Check migration status:**
```bash
docker compose -f docker-compose.prod.yml exec backend-blue npx prisma migrate status
```

**Apply migrations manually:**
```bash
docker compose -f docker-compose.prod.yml exec backend-blue npx prisma migrate deploy
```

**Rollback database:**
```bash
./scripts/rollback-deployment.sh
```

### Port Already in Use

**Check what's using the port:**
```bash
lsof -i :3000
```

**Stop old containers:**
```bash
docker stop kds_backend_prod
docker rm kds_backend_prod
```

### SSL Certificate Issues

**Check certificate:**
```bash
./scripts/health-check.sh ssl
```

**Renew certificate:**
```bash
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

### GitHub Actions Failing

**Check secrets:**
- Ensure all required secrets are configured
- Verify SSH key has proper permissions

**Test SSH connection:**
```bash
ssh -i ~/.ssh/id_ed25519 root@38.242.233.166
```

**Check workflow logs:**
- Go to GitHub Actions tab
- Click on failed workflow
- Review step-by-step logs

### PR Staging Issues

**Check PR containers:**
```bash
docker ps | grep pr_
```

**View PR logs:**
```bash
cd /root/kds/pr-123
docker compose -f docker-compose.pr.yml logs
```

**Manual cleanup:**
```bash
./scripts/pr-staging-cleanup.sh 123
```

## Best Practices

### Deployment Workflow

1. **Development:**
   - Work on feature branch
   - Create PR
   - Test in PR staging environment
   - Get code review

2. **Merge to Main:**
   - PR merged → auto-deploy to staging
   - Test thoroughly in staging

3. **Release:**
   - Create release tag: `git tag v1.0.0`
   - Push tag: `git push origin v1.0.0`
   - GitHub Actions → Blue-Green deploy
   - Verify production

### Version Numbering

Use [Semantic Versioning](https://semver.org/):
- **MAJOR** version: Breaking changes (v1.0.0 → v2.0.0)
- **MINOR** version: New features (v1.0.0 → v1.1.0)
- **PATCH** version: Bug fixes (v1.0.0 → v1.0.1)

### Testing Before Release

```bash
# Always test in PR staging first
# Then test in staging environment
# Finally, deploy to production with release tag
```

### Monitoring

- Check health endpoint: https://hummytummy.com/api/health
- Monitor logs regularly
- Set up alerts for failed deployments
- Review backup logs weekly

## Additional Resources

- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [Prisma Migrations](https://www.prisma.io/docs/concepts/components/prisma-migrate)

## Support

For issues or questions:
1. Check this documentation
2. Review GitHub Actions logs
3. Check server logs
4. Create GitHub issue

---

**Last Updated:** 2025-10-31
**Version:** 1.0.0
