# Restaurant POS System - Complete Setup Guide

This guide will walk you through setting up the complete Restaurant POS system from scratch.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start (Docker)](#quick-start-docker)
3. [Manual Setup](#manual-setup)
4. [Database Setup](#database-setup)
5. [Environment Configuration](#environment-configuration)
6. [Running the Application](#running-the-application)
7. [Production Deployment](#production-deployment)
8. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software

- **Node.js** 18+ and npm/yarn/pnpm
- **Docker** and Docker Compose (recommended)
- **PostgreSQL** 14+ (if not using Docker)
- **Redis** 6+ (if not using Docker)
- **Git**

### Recommended Tools

- **Postman** or **Insomnia** for API testing
- **pgAdmin** or **DBeaver** for database management
- **VSCode** with extensions:
  - ESLint
  - Prettier
  - Prisma
  - Tailwind CSS IntelliSense

---

## Quick Start (Docker)

The fastest way to get started is using Docker Compose.

### 1. Clone the Repository

```bash
git clone <your-repo-url>
cd kds
```

### 2. Setup Environment Variables

```bash
# Copy environment files
cp .env.production.example .env
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# Edit .env and change the default passwords and secrets!
nano .env
```

**Important:** Change these values in `.env`:
- `POSTGRES_PASSWORD`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`

### 3. Start All Services

```bash
# Start all containers (PostgreSQL, Redis, Backend, Frontend)
docker-compose up -d

# View logs
docker-compose logs -f
```

### 4. Run Database Migrations

```bash
# Run Prisma migrations
docker-compose exec backend npx prisma migrate deploy

# Seed the database with sample data
docker-compose exec backend npx prisma db seed
```

### 5. Access the Application

- **Frontend:** http://localhost:5173
- **Backend API:** http://localhost:3000/api
- **API Documentation:** http://localhost:3000/api/docs

### Default Login Credentials

After seeding:

**Admin:**
- Email: `admin@restaurant.com`
- Password: `password123`

**Waiter:**
- Email: `waiter@restaurant.com`
- Password: `password123`

**Kitchen:**
- Email: `kitchen@restaurant.com`
- Password: `password123`

> ⚠️ **Change these passwords immediately in production!**

---

## Manual Setup

If you prefer not to use Docker, follow these steps:

### 1. Install PostgreSQL

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install postgresql postgresql-contrib
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

**macOS:**
```bash
brew install postgresql@15
brew services start postgresql@15
```

**Windows:**
Download and install from [postgresql.org](https://www.postgresql.org/download/windows/)

### 2. Install Redis

**Ubuntu/Debian:**
```bash
sudo apt install redis-server
sudo systemctl start redis
sudo systemctl enable redis
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download from [redis.io](https://redis.io/download) or use WSL

### 3. Create Database

```bash
# Login to PostgreSQL
sudo -u postgres psql

# Create database and user
CREATE DATABASE restaurant_pos;
CREATE USER pos_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE restaurant_pos TO pos_user;
\q
```

### 4. Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your database credentials
nano .env

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed database
npx prisma db seed

# Start development server
npm run start:dev
```

Backend should now be running on http://localhost:3000

### 5. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your API URL
nano .env

# Start development server
npm run dev
```

Frontend should now be running on http://localhost:5173

---

## Database Setup

### Understanding the Schema

The database consists of these main tables:

- **tenants** - Multi-tenant support (restaurants)
- **users** - User accounts with roles
- **categories** - Menu categories
- **products** - Menu items
- **tables** - Restaurant tables
- **orders** - Customer orders
- **order_items** - Individual items in orders
- **payments** - Payment records
- **stock_movements** - Inventory tracking

### Managing Migrations

```bash
# Create a new migration
npx prisma migrate dev --name describe_your_changes

# Apply migrations to production
npx prisma migrate deploy

# Reset database (development only!)
npx prisma migrate reset

# View database in Prisma Studio
npx prisma studio
```

### Database Backups

**Backup:**
```bash
pg_dump -U postgres restaurant_pos > backup_$(date +%Y%m%d_%H%M%S).sql
```

**Restore:**
```bash
psql -U postgres restaurant_pos < backup_20240101_120000.sql
```

---

## Environment Configuration

### Backend Environment Variables

Edit `backend/.env`:

```env
# Application
NODE_ENV=development
PORT=3000

# Database (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/restaurant_pos"

# Redis
REDIS_URL="redis://localhost:6379"

# JWT Authentication
JWT_SECRET=your-super-secret-jwt-key-min-32-characters
JWT_EXPIRES_IN=7d
JWT_REFRESH_SECRET=your-refresh-secret-min-32-characters
JWT_REFRESH_EXPIRES_IN=30d

# CORS
CORS_ORIGIN=http://localhost:5173

# File Upload
MAX_FILE_SIZE=5242880
UPLOAD_PATH=./uploads
```

### Frontend Environment Variables

Edit `frontend/.env`:

```env
VITE_API_URL=http://localhost:3000/api
```

### Generating Secure Secrets

```bash
# Generate random JWT secret (Linux/macOS)
openssl rand -base64 32

# Or use Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

---

## Running the Application

### Development Mode

**Option 1: Docker Compose**
```bash
docker-compose up
```

**Option 2: Manual**
```bash
# Terminal 1 - Backend
cd backend
npm run start:dev

# Terminal 2 - Frontend
cd frontend
npm run dev

# Terminal 3 - Database (if not using Docker)
# PostgreSQL and Redis should be running
```

### Production Mode

```bash
# Build backend
cd backend
npm run build
npm run start:prod

# Build frontend
cd frontend
npm run build
# Serve dist/ folder with Nginx or any static server
```

---

## Production Deployment

### Using Docker Compose (Recommended)

1. **Setup server** (Ubuntu 22.04 LTS recommended)

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin
```

2. **Clone and configure**

```bash
git clone <your-repo-url>
cd kds

# Copy and edit production environment
cp .env.production.example .env
nano .env  # Set secure passwords and secrets!
```

3. **Deploy**

```bash
# Start services
docker-compose -f docker-compose.prod.yml up -d

# Run migrations
docker-compose exec backend npx prisma migrate deploy

# View logs
docker-compose logs -f
```

4. **Setup Nginx reverse proxy** (optional, for SSL)

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Deploy to Cloud Platforms

#### AWS EC2

1. Launch EC2 instance (Ubuntu 22.04, t3.medium or larger)
2. Install Docker and Docker Compose
3. Clone repository and follow Docker deployment steps
4. Configure security groups (ports 80, 443, 22)
5. Setup Route 53 for domain
6. Use AWS RDS for PostgreSQL (recommended for production)

#### DigitalOcean

1. Create Droplet (Ubuntu 22.04, 4GB RAM minimum)
2. Install Docker
3. Deploy using Docker Compose
4. Setup managed PostgreSQL database
5. Configure domain and firewall

#### Heroku

Backend can be deployed to Heroku, but Docker Compose won't work. You'll need to:
1. Deploy backend as a Heroku app
2. Use Heroku Postgres add-on
3. Deploy frontend to Vercel or Netlify

---

## Troubleshooting

### Common Issues

#### Backend won't start

**Issue:** `Error: P1001: Can't reach database server`

**Solution:**
```bash
# Check if PostgreSQL is running
sudo systemctl status postgresql

# Check connection string in .env
# Make sure DATABASE_URL is correct
```

#### Frontend can't connect to backend

**Issue:** `Network Error` or CORS errors

**Solution:**
```bash
# Check CORS_ORIGIN in backend/.env
# Should match your frontend URL

# Check VITE_API_URL in frontend/.env
# Should point to your backend
```

#### Prisma migrate fails

**Issue:** `Migration failed to apply`

**Solution:**
```bash
# Reset database (development only!)
npx prisma migrate reset

# Or manually fix
npx prisma db push --force-reset
```

#### WebSocket connection fails

**Issue:** Kitchen Display not updating in real-time

**Solution:**
1. Check that Socket.IO is running on backend
2. Verify JWT token is being sent in WebSocket handshake
3. Check browser console for errors
4. Ensure `/socket.io` path is not blocked by proxy

#### Docker container crashes

**Issue:** Container keeps restarting

**Solution:**
```bash
# View logs
docker-compose logs backend
docker-compose logs frontend

# Check container status
docker-compose ps

# Restart specific service
docker-compose restart backend
```

### Performance Optimization

#### Slow queries

```bash
# Enable query logging in Prisma
# Add to prisma service in app.module.ts:
log: ['query', 'info', 'warn', 'error']

# Add database indexes
# Check slow queries and add indexes in schema.prisma
```

#### Frontend slow loading

```bash
# Build for production with optimizations
npm run build

# Enable gzip compression in Nginx
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

### Getting Help

- **Documentation:** Check this guide first
- **Issues:** Create a GitHub issue with logs and steps to reproduce
- **Logs:** Always include relevant logs when reporting issues

```bash
# Backend logs
docker-compose logs backend

# Frontend logs
docker-compose logs frontend

# Database logs
docker-compose logs postgres
```

---

## Next Steps

After successful installation:

1. ✅ Change default passwords
2. ✅ Configure your restaurant details
3. ✅ Add your menu items
4. ✅ Setup tables
5. ✅ Create user accounts for staff
6. ✅ Test the POS workflow
7. ✅ Test the Kitchen Display
8. ✅ Setup backups
9. ✅ Monitor logs

**Enjoy your new Restaurant POS System! 🎉**
