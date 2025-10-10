#!/bin/bash

# Quick Start Script for Restaurant POS Subscription System
# This script helps set up the development environment

set -e

echo "🚀 Restaurant POS Subscription System - Quick Start"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed. Please install Docker first.${NC}"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker and Docker Compose are installed${NC}"
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠️  .env file not found. Creating from .env.docker...${NC}"
    cp .env.docker .env
    echo -e "${GREEN}✅ Created .env file${NC}"
    echo ""
    echo -e "${YELLOW}⚠️  IMPORTANT: Please edit .env and add your API keys:${NC}"
    echo "   - Stripe keys (from https://dashboard.stripe.com/apikeys)"
    echo "   - Iyzico credentials"
    echo "   - Email SMTP settings"
    echo ""
    read -p "Press Enter after updating .env file..."
else
    echo -e "${GREEN}✅ .env file exists${NC}"
fi

echo ""
echo "📦 Starting Docker services..."
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 5

# Check service health
echo ""
docker-compose ps

echo ""
echo "🔧 Setting up database..."

# Check if Prisma schema exists
if [ ! -f backend/prisma/schema.prisma ]; then
    echo -e "${RED}❌ Prisma schema not found at backend/prisma/schema.prisma${NC}"
    exit 1
fi

# Generate Prisma client
echo "Generating Prisma client..."
docker-compose exec backend npx prisma generate

# Run migrations
echo "Running database migrations..."
docker-compose exec backend npx prisma migrate deploy || {
    echo -e "${YELLOW}⚠️  Migrations may need to be created first${NC}"
    echo "Run: docker-compose exec backend npx prisma migrate dev --name init"
}

# Check if seed script exists
if [ -f backend/prisma/seed-subscriptions.ts ]; then
    echo ""
    echo "🌱 Seeding subscription plans..."
    docker-compose exec backend npx ts-node prisma/seed-subscriptions.ts || {
        echo -e "${YELLOW}⚠️  Could not seed subscription plans. You may need to create the seed script.${NC}"
    }
else
    echo -e "${YELLOW}⚠️  Seed script not found at backend/prisma/seed-subscriptions.ts${NC}"
    echo "You'll need to manually create subscription plans in the database."
fi

echo ""
echo -e "${GREEN}✅ Setup complete!${NC}"
echo ""
echo "📍 Access Points:"
echo "   Frontend:  http://localhost:5173"
echo "   Backend:   http://localhost:3000"
echo "   Postgres:  localhost:5432"
echo "   Redis:     localhost:6379"
echo ""
echo "📝 Useful Commands:"
echo "   View logs:        docker-compose logs -f"
echo "   Stop services:    docker-compose down"
echo "   Restart backend:  docker-compose restart backend"
echo "   Prisma Studio:    docker-compose exec backend npx prisma studio"
echo ""
echo "📚 Next Steps:"
echo "   1. Configure Stripe webhooks: https://dashboard.stripe.com/webhooks"
echo "      Endpoint: http://localhost:3000/webhooks/stripe (use ngrok for testing)"
echo "   2. Configure Iyzico callbacks in merchant panel"
echo "   3. Test email sending by creating a subscription with trial"
echo "   4. Review DEPLOYMENT_CHECKLIST.md for production deployment"
echo ""
echo -e "${GREEN}Happy coding! 🎉${NC}"
