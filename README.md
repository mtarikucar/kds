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
- ✅ **Subscription System** - Complete SaaS billing with Stripe & Iyzico
  - Monthly and yearly billing cycles
  - 4 subscription tiers (FREE, BASIC, PRO, BUSINESS)
  - One-time trial period per restaurant
  - Upgrade/downgrade/cancel anytime
  - Plan-based feature access control
  - Auto-renewable subscriptions
  - Email notifications and invoice PDFs
  - Region-aware payment routing (Turkey → Iyzico, International → Stripe)

### Coming Soon (Phase 2)
- 🔄 Delivery management with courier tracking
- 🔄 Recipe/BOM (Bill of Materials) tracking
- 🔄 Third-party integrations (delivery platforms, e-Invoice)
- 🔄 Advanced analytics and exports
- 🔄 Mobile applications (React Native)

## 🏗️ Tech Stack

### Backend
- **Framework**: NestJS (TypeScript)
- **Database**: PostgreSQL
- **ORM**: Prisma
- **Authentication**: JWT + RBAC
- **Real-time**: Socket.IO
- **Cache**: Redis
- **Payments**: Stripe SDK + Iyzico SDK
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

# Edit .env with your API keys (Stripe, Iyzico, Email)
nano .env

# Start all services
docker-compose up -d

# Run migrations
docker-compose exec backend npx prisma migrate deploy

# Seed subscription plans
docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts

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
- Deployment Checklist: See `DEPLOYMENT_CHECKLIST.md`
- Docker Guide: See `DOCKER_DEPLOYMENT.md`
- Subscription System: See `SUBSCRIPTION_SYSTEM.md`

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
│   │   │   └── subscriptions/  # NEW: Subscription system
│   │   │       ├── controllers/
│   │   │       ├── services/
│   │   │       ├── guards/
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
│   │   │   └── subscription/   # NEW: Pricing, checkout
│   │   ├── components/    # Reusable components
│   │   ├── features/      # Feature-specific code
│   │   ├── lib/          # Utilities & config
│   │   └── types/        # TypeScript types
│   └── public/
│
├── docker/                # Docker configs
│   └── nginx/
│       └── nginx.conf
│
├── docker-compose.yml              # Development setup
├── docker-compose.prod.yml         # Production setup
├── .env.docker                     # Environment template
├── quick-start.sh                  # Automated setup script
├── DEPLOYMENT_CHECKLIST.md         # Deployment guide
├── DOCKER_DEPLOYMENT.md            # Docker guide
├── SUBSCRIPTION_SYSTEM.md          # Subscription docs
├── COMPLETE_IMPLEMENTATION_GUIDE.md # Full implementation
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

# Payment Providers
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_secret
IYZICO_API_KEY=your_api_key
IYZICO_SECRET_KEY=your_secret_key
IYZICO_BASE_URL=https://api.iyzipay.com

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your-email@domain.com
EMAIL_PASSWORD=your-password
EMAIL_FROM=noreply@yourdomain.com

# Subscription
DEFAULT_TRIAL_DAYS=14
TRIAL_REMINDER_DAYS=3
```

**Frontend (.env):**
```env
VITE_API_URL=https://api.yourdomain.com
VITE_WS_URL=https://api.yourdomain.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_your_key
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
- [x] Subscription System (Stripe + Iyzico)
- [x] Email Notifications
- [x] Invoice PDF Generation
- [x] Docker Deployment
- [ ] Mobile app (React Native)
- [ ] Delivery partner integrations
- [ ] Advanced inventory (BOM)
- [ ] Multi-location support
- [ ] Loyalty programs
- [ ] E-Invoice integration

---

Built with ❤️ for restaurants by your team
"# kds" 
