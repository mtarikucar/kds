#!/bin/bash

# Restaurant POS System - Quick Start Script
# This script helps you get the application running quickly

set -e

echo "🍽️  Restaurant POS System - Quick Start"
echo "========================================"
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    echo "   Visit: https://docs.docker.com/get-docker/"
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    echo "   Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.production.example .env
    echo "⚠️  IMPORTANT: Please edit .env and change the default passwords!"
    echo "   Run: nano .env"
    echo ""
    read -p "Press Enter to continue after editing .env..."
fi

# Create backend .env if it doesn't exist
if [ ! -f backend/.env ]; then
    echo "📝 Creating backend/.env file..."
    cp backend/.env.example backend/.env
fi

# Create frontend .env if it doesn't exist
if [ ! -f frontend/.env ]; then
    echo "📝 Creating frontend/.env file..."
    cp frontend/.env.example frontend/.env
fi

echo "🐳 Starting Docker containers..."
docker-compose up -d

echo "⏳ Waiting for services to be ready..."
sleep 10

echo "🗄️  Running database migrations..."
docker-compose exec -T backend npx prisma migrate deploy

echo "🌱 Seeding database with sample data..."
docker-compose exec -T backend npx prisma db seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "🚀 Application is now running:"
echo "   Frontend: http://localhost:5173"
echo "   Backend:  http://localhost:3000/api"
echo "   API Docs: http://localhost:3000/api/docs"
echo ""
echo "📝 Default login credentials:"
echo "   Admin:  admin@restaurant.com / password123"
echo "   Waiter: waiter@restaurant.com / password123"
echo ""
echo "📊 View logs: docker-compose logs -f"
echo "🛑 Stop: docker-compose down"
echo ""
echo "⚠️  Remember to change default passwords in production!"
