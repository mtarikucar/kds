# GitHub Secrets Configuration Guide

This guide explains how to configure GitHub Secrets for the CI/CD pipeline.

## Overview

The Restaurant POS system uses GitHub Actions for automated testing and deployment to staging and production environments. These workflows require sensitive credentials stored as GitHub Secrets.

## Required Secrets

### SSH Credentials

#### `SSH_PRIVATE_KEY`
Your private SSH key for accessing deployment servers.

**How to generate:**
```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions@restaurant-pos" -f ~/.ssh/github_actions_deploy

# Copy the private key
cat ~/.ssh/github_actions_deploy

# Copy the public key to your servers
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@staging-server
ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@production-server
```

**Value:** Entire content of the private key file (including header/footer)
```
-----BEGIN OPENSSH PRIVATE KEY-----
...private key content...
-----END OPENSSH PRIVATE KEY-----
```

#### `SSH_KNOWN_HOSTS`
Known hosts fingerprints for your deployment servers.

**How to generate:**
```bash
# Get known hosts for both servers
ssh-keyscan -H staging.yourserver.com >> known_hosts
ssh-keyscan -H production.yourserver.com >> known_hosts

# View the content
cat known_hosts
```

**Value:** Content of known_hosts file
```
|1|hash...=|hash...= ssh-rsa AAAA...
|1|hash...=|hash...= ssh-ed25519 AAAA...
```

### Staging Server Configuration

#### `STAGING_SERVER_HOST`
Hostname or IP address of your staging server.

**Example:** `staging.yourapp.com` or `192.168.1.100`

#### `STAGING_SERVER_USER`
SSH username for the staging server.

**Example:** `ubuntu`, `deploy`, or `root`

### Production Server Configuration

#### `PRODUCTION_SERVER_HOST`
Hostname or IP address of your production server.

**Example:** `yourapp.com` or `203.0.113.10`

#### `PRODUCTION_SERVER_USER`
SSH username for the production server.

**Example:** `ubuntu`, `deploy`, or `root`

### GitHub Token (Automatically Provided)

#### `GITHUB_TOKEN`
Automatically provided by GitHub Actions. No configuration needed.

**Used for:**
- Creating GitHub releases
- Adding commit comments
- Repository operations

## How to Add Secrets

### Via GitHub Web Interface

1. Go to your repository on GitHub
2. Click **Settings** tab
3. Click **Secrets and variables** → **Actions**
4. Click **New repository secret**
5. Enter the secret name (exactly as shown above)
6. Paste the secret value
7. Click **Add secret**

### Via GitHub CLI

```bash
# Install GitHub CLI if not already installed
# macOS: brew install gh
# Linux: See https://github.com/cli/cli/blob/trunk/docs/install_linux.md

# Authenticate
gh auth login

# Add secrets
gh secret set SSH_PRIVATE_KEY < ~/.ssh/github_actions_deploy
gh secret set SSH_KNOWN_HOSTS < known_hosts
gh secret set STAGING_SERVER_HOST -b "staging.yourapp.com"
gh secret set STAGING_SERVER_USER -b "ubuntu"
gh secret set PRODUCTION_SERVER_HOST -b "yourapp.com"
gh secret set PRODUCTION_SERVER_USER -b "ubuntu"
```

## Server Setup Requirements

### Prerequisites on Deployment Servers

Both staging and production servers must have:

```bash
# 1. Docker and Docker Compose installed
sudo apt-get update
sudo apt-get install -y docker.io docker-compose

# 2. Git installed
sudo apt-get install -y git

# 3. Project directory created
sudo mkdir -p /opt/kds
sudo chown $USER:$USER /opt/kds

# 4. Clone repository
cd /opt/kds
git clone https://github.com/your-username/your-repo.git .

# 5. Create .env files
cp .env.example .env.staging  # for staging
cp .env.example .env.production  # for production

# Edit the env files with actual credentials
nano .env.staging
nano .env.production

# 6. Make scripts executable
chmod +x scripts/*.sh

# 7. Create backup directory
mkdir -p /opt/kds/backups/database
```

### Required Directory Structure

```
/opt/kds/
├── .env.staging          # Staging environment variables
├── .env.production       # Production environment variables
├── docker-compose.staging.yml
├── docker-compose.prod.yml
├── scripts/
│   ├── backup-database.sh
│   └── rollback-deployment.sh
├── backend/
├── frontend/
└── backups/
    └── database/         # Database backups stored here
```

### Environment Files Configuration

#### Staging (.env.staging)
```env
NODE_ENV=staging
DATABASE_URL=postgresql://user:pass@localhost:5432/restaurant_pos_staging
REDIS_URL=redis://localhost:6379/1
JWT_SECRET=staging-secret-change-in-production
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
# ... other variables
```

#### Production (.env.production)
```env
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@localhost:5432/restaurant_pos_prod
REDIS_URL=redis://localhost:6379/2
JWT_SECRET=super-secure-production-secret
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
# ... other variables
```

## Workflows

### 1. Test Workflow (`.github/workflows/test.yml`)

**Trigger:** All branches and pull requests

**What it does:**
- Sets up Node.js environment
- Installs dependencies
- Runs ESLint
- Executes tests (backend + frontend)
- Builds the application

**Required Secrets:** None (uses workflow-level services)

### 2. Staging Deployment (`.github/workflows/deploy-staging.yml`)

**Trigger:** Push to `main` branch (automatic)

**What it does:**
1. Runs test workflow first
2. SSH into staging server
3. Pull latest code from main branch
4. Rebuild Docker containers
5. Run database migrations
6. Health check verification
7. Post deployment notification

**Required Secrets:**
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`
- `STAGING_SERVER_HOST`
- `STAGING_SERVER_USER`

**Command:**
```bash
# Workflow runs automatically on push to main
git push origin main
```

### 3. Production Deployment (`.github/workflows/deploy-production.yml`)

**Trigger:** Manual (workflow_dispatch) with version input

**What it does:**
1. Runs test workflow first
2. **Backup database** (safety first!)
3. SSH into production server
4. Pull latest code
5. Rebuild Docker containers
6. Run database migrations
7. Health check verification
8. Create Git tag (e.g., v1.2.3)
9. Create GitHub release
10. Post deployment notification
11. **Automatic rollback on failure**

**Required Secrets:**
- `SSH_PRIVATE_KEY`
- `SSH_KNOWN_HOSTS`
- `PRODUCTION_SERVER_HOST`
- `PRODUCTION_SERVER_USER`
- `GITHUB_TOKEN` (automatic)

**Command:**
```bash
# Via GitHub UI:
# 1. Go to Actions tab
# 2. Select "Deploy to Production"
# 3. Click "Run workflow"
# 4. Enter version (e.g., v1.2.3)
# 5. Click "Run workflow"

# Via GitHub CLI:
gh workflow run deploy-production.yml -f version=v1.2.3
```

## Testing the Setup

### Step 1: Test SSH Connection

```bash
# Test staging server
ssh -i ~/.ssh/github_actions_deploy ubuntu@staging.yourapp.com "echo 'SSH works'"

# Test production server
ssh -i ~/.ssh/github_actions_deploy ubuntu@yourapp.com "echo 'SSH works'"
```

### Step 2: Verify Secrets Are Set

```bash
# List all secrets (won't show values, only names)
gh secret list
```

Expected output:
```
SSH_PRIVATE_KEY            Updated 2024-01-15
SSH_KNOWN_HOSTS            Updated 2024-01-15
STAGING_SERVER_HOST        Updated 2024-01-15
STAGING_SERVER_USER        Updated 2024-01-15
PRODUCTION_SERVER_HOST     Updated 2024-01-15
PRODUCTION_SERVER_USER     Updated 2024-01-15
```

### Step 3: Test Staging Deployment

1. Make a small change to the code
2. Commit and push to main branch
3. Watch the GitHub Actions tab
4. Verify deployment succeeds

```bash
git add .
git commit -m "Test staging deployment"
git push origin main
```

### Step 4: Test Production Deployment

1. Go to GitHub Actions tab
2. Run "Deploy to Production" workflow
3. Enter version: `v0.1.0-test`
4. Watch the deployment process
5. Verify rollback works (if it fails)

## Security Best Practices

### SSH Key Security

✅ **DO:**
- Generate a dedicated SSH key for deployments
- Use ed25519 keys (more secure than RSA)
- Set proper permissions on keys (`chmod 600`)
- Use passphrase-protected keys when possible
- Rotate keys periodically (every 90 days)
- Limit SSH key to specific commands (if possible)

❌ **DON'T:**
- Reuse your personal SSH key
- Commit private keys to repository
- Share private keys via insecure channels
- Use weak RSA keys (< 2048 bits)

### Server Access

✅ **DO:**
- Use non-root users for deployment
- Configure sudo access as needed
- Enable SSH key-only authentication
- Use firewall rules (UFW, iptables)
- Keep server packages updated
- Monitor server logs

❌ **DON'T:**
- Use root user for deployments
- Allow password authentication
- Expose unnecessary ports
- Run services as root

### Environment Variables

✅ **DO:**
- Use strong, unique secrets for each environment
- Rotate secrets regularly
- Use different credentials for staging/production
- Document required variables
- Validate environment on deployment

❌ **DON'T:**
- Hardcode secrets in code
- Commit .env files
- Use weak or default secrets
- Share production credentials

## Troubleshooting

### SSH Connection Failed

**Error:** `Permission denied (publickey)`

**Solutions:**
1. Verify public key is added to server:
   ```bash
   ssh-copy-id -i ~/.ssh/github_actions_deploy.pub user@server
   ```

2. Check SSH key format in GitHub Secrets:
   - Must include header `-----BEGIN OPENSSH PRIVATE KEY-----`
   - Must include footer `-----END OPENSSH PRIVATE KEY-----`
   - No extra whitespace

3. Verify known_hosts:
   ```bash
   ssh-keyscan -H your-server.com
   ```

### Deployment Failed

**Check workflow logs:**
1. Go to Actions tab
2. Click on failed workflow run
3. Expand failed step
4. Check error message

**Common issues:**
- Docker not running on server
- Insufficient disk space
- Database migration failed
- Health check timeout

### Database Backup Failed

**Check:**
1. PostgreSQL client installed on server
2. Database credentials correct in .env file
3. Backup directory exists and is writable
4. Sufficient disk space

```bash
# Test backup manually
ssh user@server "cd /opt/kds && ./scripts/backup-database.sh"
```

### Rollback Failed

**Manual rollback:**
```bash
# SSH into server
ssh user@production-server

# Run rollback script
cd /opt/kds
./scripts/rollback-deployment.sh
```

## Monitoring Deployments

### GitHub Actions Status Badge

Add to README.md:
```markdown
![Deploy to Production](https://github.com/your-username/your-repo/workflows/Deploy%20to%20Production/badge.svg)
![Deploy to Staging](https://github.com/your-username/your-repo/workflows/Deploy%20to%20Staging/badge.svg)
```

### Slack/Discord Notifications (Optional)

Add webhook notifications to workflows:
```yaml
- name: Notify Slack
  if: always()
  uses: 8398a7/action-slack@v3
  with:
    status: ${{ job.status }}
    webhook_url: ${{ secrets.SLACK_WEBHOOK }}
```

## Maintenance

### Regular Tasks

**Weekly:**
- [ ] Review deployment logs
- [ ] Check disk space on servers
- [ ] Verify backups are being created

**Monthly:**
- [ ] Test rollback procedure
- [ ] Review and rotate secrets
- [ ] Update dependencies
- [ ] Test disaster recovery

**Quarterly:**
- [ ] Rotate SSH keys
- [ ] Review server access logs
- [ ] Update server packages
- [ ] Performance audit

## Next Steps

1. **Set up monitoring:**
   - Application performance monitoring (APM)
   - Server monitoring (CPU, memory, disk)
   - Log aggregation

2. **Implement staging → production promotion:**
   - Tag staging deployments
   - Promote tested versions to production
   - Automated smoke tests

3. **Add more environments:**
   - Development
   - QA/Testing
   - Pre-production

4. **Implement blue-green deployment:**
   - Zero-downtime deployments
   - Quick rollback capability
   - Load balancer configuration

## Support

For deployment issues:
- Check GitHub Actions logs
- Review server logs: `journalctl -u docker`
- Check application logs: `docker-compose logs`
- Verify environment variables
- Test SSH connectivity

## Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [GitHub Secrets Documentation](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Docker Deployment Best Practices](https://docs.docker.com/develop/dev-best-practices/)
- [SSH Key Best Practices](https://www.ssh.com/academy/ssh/key)
