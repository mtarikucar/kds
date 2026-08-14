# Restaurant POS & Management Platform

A modern cloud-based restaurant POS system built with NestJS, React, and PostgreSQL. Manage in-house dining, takeaway, and delivery orders with real-time kitchen display, inventory tracking, and comprehensive reporting.

## 🚀 Features

### MVP (Phase 1)
- ✅ **Multi-tenant Architecture** - Support multiple restaurants with data isolation
- ✅ **Role-Based Access Control** - Admin, Waiter, Kitchen, Manager roles
- ✅ **POS System** - Create and manage orders for dine-in, takeaway, and delivery
- ✅ **Kitchen Display System (KDS)** - Real-time order updates via WebSocket
- ✅ **Menu Management** - CRUD operations for categories and products
- ✅ **QR Menu** - Customers scan QR codes to view live menu
- ✅ **Stock Tracking** - Simple inventory management with low-stock alerts
- ✅ **Payment Processing** - Track payments with multiple methods
- ✅ **Reports** - Daily sales, top products, payment summaries
- ✅ **Free Core + À-la-carte Licensing** - No plans, no tiers, no trial
  - The core is free forever: POS, KDS, menu, tables/floor plan, QR menu, orders,
    cash drawer, basic reports, team & roles, customers, device/branch panel, custom
    branding. Users, tables, products, categories and monthly orders are uncapped
    (`-1`); the first branch is free
    (`backend/src/modules/entitlements/free-baseline.const.ts`)
  - Paid capability is bought item by item from one catalog — an annual licence
    unlocks the paid rail, then individual modules, integrations, extra branches,
    one-time credit packs and services
    (`backend/src/modules/marketplace/alacarte-catalog.const.ts`)
  - Entitlement engine folds free baseline + purchased grants into one set that
    both the backend guards and the SPA read
    (`backend/src/modules/entitlements/`)
  - Day-prorated to a fixed account anniversary (the licence purchase date); lines
    within 14 days of the anniversary roll into the next full cycle, no line below
    1 TRY (`backend/src/modules/licensing/anniversary.ts`)
  - Manual renewal — no stored card, no automatic capture. Reminders at 30/7/1 days,
    then a 7-day grace period; after that access dims but data is retained
    (`backend/src/modules/licensing/renewal-scheduler.service.ts`)
  - Collection runs on PayTR, TRY only
    (`backend/src/modules/payments/adapters/paytr.adapter.ts`)
  - Email notifications and invoice PDFs
- ✅ **Recipe/BOM & Cost Control** - Recipes, recipe costing, stock deduction, counts,
  waste logs, purchase orders/invoices, suppliers, reorder suggestions
- ✅ **Delivery Platform Integrations** - Yemeksepeti, Getir and Trendyol Yemek orders
  flow into the POS and kitchen (a Migros adapter also exists in code but is not in
  the sold catalog)
- ✅ **e-Document & Fiscal** - e-Invoice/e-Archive via Nilvera (plus Paraşüt, Logo,
  Foriba adapters), ÖKC/fiscal core, Z-Reports
- ✅ **Advanced Analytics** - Analytics module with scheduled aggregation; daily sales
  CSV export for accountants
- ✅ **Customers** - Customer records plus a points-based loyalty service
  (Bronze/Silver/Gold/Platinum earn multipliers) and a referral service

### Coming Soon (Phase 2)
- 🔄 In-house courier/dispatch management (today's delivery flow relies on the
  marketplace platforms' own couriers)
- 🔄 Mobile applications (React Native)

## 🏗️ Tech Stack

### Backend
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT + RBAC
- **Real-time**: Socket.IO
- **Cache**: Redis
- **Payments**: PayTR (direct REST + hash integration, no vendor SDK)
- **Email**: Nodemailer with Handlebars templates
- **PDF Generation**: PDFKit
- **Task Scheduling**: @nestjs/schedule (Cron jobs)

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: React Query (TanStack Query)
- **Routing**: React Router v6
- **Real-time**: Socket.IO Client

### Desktop App (NEW!)
- **Framework**: Tauri (Rust + Web)
- **Features**: Native performance, printer support, offline mode
- **Bundle Size**: ~10 MB (vs 100+ MB Electron apps)
- **Platforms**: Windows, macOS, Linux

### DevOps
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx
- **CI/CD**: GitHub Actions
- **Cloud**: AWS/DigitalOcean ready

## 📋 Prerequisites

- Node.js 18+ and npm/yarn/pnpm
- Docker and Docker Compose
- PostgreSQL 14+ (or use Docker)
- Redis 6+ (or use Docker)

## 🛠️ Installation

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd kds
```

### 2. Setup Backend

```bash
cd backend
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your database credentials
# DATABASE_URL="postgresql://user:password@localhost:5432/restaurant_pos"
# JWT_SECRET="your-secret-key"
# REDIS_URL="redis://localhost:6379"

# Run Prisma migrations
npx prisma migrate dev

# Seed database (optional)
npx prisma db seed

# Start development server
npm run start:dev
```

Backend runs on: `http://localhost:3000`
API Documentation: `http://localhost:3000/api/docs`

### 3. Setup Frontend

```bash
cd frontend
npm install

# Copy environment file
cp .env.example .env

# Edit .env
# VITE_API_URL=http://localhost:3000
# VITE_WS_URL=http://localhost:3000

# Start development server
npm run dev
```

Frontend runs on: `http://localhost:5173`

### 4. Using Docker (Recommended)

```bash
# Quick start - uses automated setup script
./quick-start.sh

# OR manual setup:
# Copy environment file
cp .env.docker .env

# Edit .env with your API keys (PayTR, Email)
nano .env

# Start all services
docker-compose up -d

# Run migrations
docker-compose exec backend npx prisma migrate deploy

# Seed the à-la-carte marketplace catalog (add-ons, hardware SKUs, providers)
docker-compose exec backend npm run seed:marketplace

# View logs
docker-compose logs -f
```

**Services:**
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`

**📚 Detailed Documentation:**
- Quick Start: Run `./quick-start.sh`
- **Desktop App**: See [`desktop/README.md`](desktop/README.md)
- **Deployment**: See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- **Licensing & Billing**: the design spec is
  [`docs/superpowers/specs/2026-08-11-alacarte-licensing-design.md`](docs/superpowers/specs/2026-08-11-alacarte-licensing-design.md);
  the runtime sources of truth are `backend/src/modules/marketplace/alacarte-catalog.const.ts`
  (catalog + prices) and `backend/src/modules/entitlements/free-baseline.const.ts` (free core).
  `backend/SUBSCRIPTION_SYSTEM.md` describes the tiered Stripe/Iyzico rail that was retired
  in migration `20260811140000_retire_subscription_rail` — keep it only as history.
- Multi-Environment Setup: See section below
- **Architecture Quality Audit**: See [`docs/architecture/QUALITY_AUDIT.md`](docs/architecture/QUALITY_AUDIT.md) — 30-attribute scorecard with evidence and roadmap
- **Architecture Decision Records**: See [`docs/architecture/adr/`](docs/architecture/adr/)

## 🌍 Multi-Environment Setup

This project supports a professional development workflow with **Development**, **Staging**, and **Production** environments, each with automatic CI/CD deployment via GitHub Actions.

### Environment Overview

| Environment | Branch | Deployment | Port (Backend) | Port (Frontend) | Database | Redis DB |
|------------|--------|------------|----------------|----------------|----------|----------|
| **Development** | `develop` | Auto on push | 3001 | 5174 | `restaurant_pos_dev` | 0 |
| **Staging** | `main` | Auto on push | 3002 | 5175 | `restaurant_pos_staging` | 1 |
| **Production** | `main` | Manual approval | 3000 | 80 | `restaurant_pos_prod` | 2 |

### Environment Configuration Files

Each environment has its own configuration:

- `.env.development` - Development settings (tracked in Git)
- `.env.staging` - Staging settings (tracked in Git)
- `.env.production` - Production secrets (NOT tracked, use `.env.production.template`)

### Local Development

```bash
# Clone and checkout develop branch
git clone <your-repo-url>
cd kds
git checkout develop

# Start development environment
docker-compose -f docker-compose.dev.yml up -d

# Run migrations
docker-compose -f docker-compose.dev.yml exec backend npx prisma migrate deploy

# View logs
docker-compose -f docker-compose.dev.yml logs -f
```

Access:
- Backend: http://localhost:3001
- Frontend: http://localhost:5174
- API Docs: http://localhost:3001/api/docs

### Server Deployment Setup

On your VPS/server, set up all environments:

```bash
# 1. Install prerequisites
sudo apt update
sudo apt install -y docker.io docker-compose git

# 2. Clone repository
cd /opt
sudo git clone <your-repo-url> kds
cd kds

# 3. Create production environment file from template
cp .env.production.template .env.production

# Edit with production values
sudo nano .env.production

# 4. Set up GitHub Actions secrets
# Go to GitHub repo → Settings → Secrets and Variables → Actions
# Add these secrets:
#   - SERVER_HOST: Your server IP
#   - SERVER_USERNAME: SSH username
#   - SERVER_SSH_KEY: Private SSH key
#   - Plus all environment-specific secrets (JWT_SECRET, PAYTR_MERCHANT_KEY, etc.)
```

### Deployment Workflow

#### 1. Development Environment
```bash
# Push to develop branch triggers automatic deployment
git checkout develop
git add .
git commit -m "Add new feature"
git push origin develop
# GitHub Actions automatically deploys to development environment
```

#### 2. Staging Environment
```bash
# Merge to main triggers automatic deployment to staging
git checkout main
git merge develop
git push origin main
# GitHub Actions automatically deploys to staging environment
```

#### 3. Production Environment
```bash
# Manual deployment via GitHub Actions
# Go to GitHub repo → Actions → CI/CD Pipeline → Run workflow
# Select "production" from dropdown
# Click "Run workflow"
```

### Manual Deployment Script

Use the included deployment script for manual deployments:

```bash
# Deploy to any environment
./deploy.sh [environment] [action]

# Examples:
./deploy.sh development deploy    # Deploy to development
./deploy.sh staging deploy         # Deploy to staging
./deploy.sh production deploy      # Deploy to production

# Other commands:
./deploy.sh production status      # Check deployment status
./deploy.sh production logs        # View logs
./deploy.sh production backup      # Create database backup
./deploy.sh production rollback    # Rollback to previous version
./deploy.sh staging restart        # Restart services
```

### Database Setup

On your server, create separate databases for each environment:

```bash
# Connect to PostgreSQL
docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres

# Create databases
CREATE DATABASE restaurant_pos_dev;
CREATE DATABASE restaurant_pos_staging;
CREATE DATABASE restaurant_pos_prod;

# Exit
\q
```

Each environment uses a different Redis database number (0, 1, 2) on the same Redis instance for data isolation.

### CI/CD Pipeline Features

The GitHub Actions workflow includes:

- **Automated Testing**: Runs on all PRs and pushes
  - Backend linting and tests
  - Frontend linting and build checks
  - PostgreSQL service for integration tests

- **Environment Deployment**:
  - Development: Auto-deploy on push to `develop`
  - Staging: Auto-deploy on push to `main`
  - Production: Manual workflow dispatch with approval

- **Safety Features**:
  - Database backups before production deployments
  - Health checks after deployment
  - Automatic rollback on failure
  - Zero-downtime deployments

### Branching Strategy

```
develop (development environment)
   ↓
   └─→ merge to main → staging environment
         ↓
         └─→ manual deploy → production environment
```

**Workflow:**
1. Create feature branches from `develop`
2. Merge features into `develop` → Auto-deploys to development
3. When stable, merge `develop` to `main` → Auto-deploys to staging
4. Test thoroughly on staging
5. Manually trigger production deployment from GitHub Actions

### Monitoring & Troubleshooting

```bash
# Check all environment statuses
./deploy.sh development status
./deploy.sh staging status
./deploy.sh production status

# View real-time logs
./deploy.sh development logs
./deploy.sh staging logs
./deploy.sh production logs

# Check Docker containers
docker ps | grep kds

# Check specific environment
docker-compose -f docker-compose.staging.yml ps
```

### Environment URLs (on your server)

- **Development**: http://your-server:5174
- **Staging**: http://your-server:5175
- **Production**: http://your-server (port 80)

### Best Practices

1. **Never commit secrets**: Use environment variables for all sensitive data
2. **Test in development first**: Always test changes in dev before staging
3. **Verify staging**: Thoroughly test on staging before production
4. **Database backups**: Always backup before major changes (automatic in production)
5. **Rollback plan**: Know how to rollback if something goes wrong
6. **Monitor logs**: Check logs after each deployment

## 📁 Project Structure

```
kds/
├── backend/                 # NestJS Backend
│   ├── src/
│   │   ├── modules/        # Feature modules
│   │   │   ├── auth/
│   │   │   ├── tenants/
│   │   │   ├── users/
│   │   │   ├── menu/
│   │   │   ├── orders/
│   │   │   ├── kds/
│   │   │   ├── stock/
│   │   │   ├── reports/
│   │   │   ├── entitlements/   # Free core baseline + entitlement engine/guards
│   │   │   ├── marketplace/    # À-la-carte catalog (single source of prices)
│   │   │   ├── licensing/      # Anniversary, proration, manual renewal cycle
│   │   │   ├── checkout/       # Purchase intents, settlement, quotes
│   │   │   ├── payments/       # PayTR adapter
│   │   │   └── subscriptions/  # Billing records, invoices, notifications
│   │   │       ├── controllers/
│   │   │       ├── services/
│   │   │       ├── decorators/
│   │   │       └── templates/emails/
│   │   ├── common/         # Shared utilities
│   │   └── prisma/         # Database schema
│   ├── storage/            # NEW: Invoice PDFs
│   │   └── invoices/
│   ├── test/
│   └── prisma/
│       └── schema.prisma
│
├── frontend/               # React Frontend
│   ├── src/
│   │   ├── pages/         # Page components
│   │   │   ├── auth/
│   │   │   ├── pos/
│   │   │   ├── kitchen/
│   │   │   ├── admin/
│   │   │   ├── qr-menu/
│   │   │   └── subscription/   # PayTR payment result page
│   │   ├── components/    # Reusable components
│   │   ├── features/      # Feature-specific code
│   │   │   ├── marketplace/    # Add-on storefront
│   │   │   └── licensing/      # Catalog store, licence & renewal pages
│   │   ├── lib/          # Utilities & config
│   │   └── types/        # TypeScript types
│   └── public/
│
├── docker/                # Docker configs
│   └── nginx/
│       └── nginx.conf
│
├── .github/
│   └── workflows/
│       └── ci-cd.yml               # GitHub Actions CI/CD
│
├── docker-compose.yml              # Local development (legacy)
├── docker-compose.dev.yml          # Development environment
├── docker-compose.staging.yml      # Staging environment
├── docker-compose.prod.yml         # Production environment
│
├── .env.development                # Development config (tracked)
├── .env.staging                    # Staging config (tracked)
├── .env.production.template        # Production template
├── .env.docker                     # Legacy environment file
│
├── deploy.sh                       # Multi-environment deployment script
├── quick-start.sh                  # Automated setup script
├── docs/DEPLOYMENT.md              # Deployment guide
├── desktop/README.md               # Desktop (Tauri) guide
└── README.md
```

## 🔐 Default Credentials

After seeding the database:

**Admin Account:**
- Email: `admin@restaurant.com`
- Password: `admin123`

**Waiter Account:**
- Email: `waiter@restaurant.com`
- Password: `waiter123`

> ⚠️ **Change these credentials in production!**

## 🎯 Usage

### For Restaurant Admins
1. Login with admin credentials
2. Setup your menu (categories and products)
3. Configure tables
4. Create user accounts for waiters and kitchen staff

### For Waiters
1. Login to POS interface
2. Select a table
3. Add items to order
4. Submit order (pushes to kitchen)
5. Process payment when ready

### For Kitchen Staff
1. Open Kitchen Display System
2. View incoming orders in real-time
3. Mark orders as "Preparing" → "Ready"
4. Waiter gets notified

### For Customers
1. Scan QR code at table
2. View live menu
3. (Future: place orders directly)

## 🧪 Testing

```bash
# Backend unit tests
cd backend
npm run test

# Backend e2e tests
npm run test:e2e

# Frontend tests
cd frontend
npm run test
```

## 📦 Deployment

### Production Build

```bash
# Backend
cd backend
npm run build
npm run start:prod

# Frontend
cd frontend
npm run build
# Serve dist/ folder with Nginx or any static host
```

### Using Docker

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Environment Variables

**Backend (.env):**
```env
# Core
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://host:6379
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
CORS_ORIGIN=https://yourdomain.com

# Payment Provider (PayTR — the only gateway we collect through; TRY only)
PAYTR_MERCHANT_ID=your_merchant_id
PAYTR_MERCHANT_KEY=your_merchant_key
PAYTR_MERCHANT_SALT=your_merchant_salt
PAYTR_BASE_URL=https://www.paytr.com
PAYTR_TEST_MODE=false

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your-password
EMAIL_FROM=noreply@yourdomain.com
```

**Frontend (.env):**
```env
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=https://api.yourdomain.com
```

**Landing (.env):**
```env
NEXT_PUBLIC_BASE_URL=https://hummytummy.com
NEXT_PUBLIC_API_URL=https://api.hummytummy.com

# Web-chat launcher. Both have working defaults, so production needs no
# wiring. Set the key to an EMPTY string on staging/preview so test traffic
# does not open real conversations in the shared inbox.
NEXT_PUBLIC_WEBCHAT_WIDGET_KEY=wc_...
NEXT_PUBLIC_WEBCHAT_HOST=https://jeetagrowth.com
```

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/yourrepo/issues)
- Documentation: [View docs](https://docs.yourapp.com)

## 🗺️ Roadmap

- [x] MVP Core Features
- [x] Free core + à-la-carte licensing on PayTR
- [x] Email Notifications
- [x] Invoice PDF Generation
- [x] Docker Deployment
- [x] Delivery partner integrations (Yemeksepeti, Getir, Trendyol Yemek)
- [x] Advanced inventory (recipes/BOM, costing, purchasing)
- [x] Multi-location support (free branch hub; extra branches are a paid capacity add-on)
- [x] Loyalty & referral
- [x] E-Invoice integration (Nilvera and other e-document adapters)
- [ ] Mobile app (React Native)
- [ ] In-house courier/dispatch management

---

Built with ❤️ for restaurants by your team
"# kds" 

