#!/bin/bash

# Fix permission issues and restart backend server
echo "🔧 Fixing permission issues..."

# Stop all node processes
pkill -f "nest start" || true
sleep 2

# Fix permissions on dist folder
sudo chown -R $USER:$USER dist/ 2>/dev/null || sudo rm -rf dist/

# Clean and rebuild
echo "🏗️  Building application..."
npm run build

# Start dev server
echo "🚀 Starting development server..."
npm run start:dev

echo "✅ Server should be starting now!"
