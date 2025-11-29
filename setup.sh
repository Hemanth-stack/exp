#!/bin/bash

echo "🚀 Setting up Enterprise AI App Builder Platform..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

echo "✅ Docker is running"

# Start Docker services
echo "📦 Starting PostgreSQL and Redis..."
docker-compose up -d

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 5

# Generate migrations
echo "🔧 Generating database migrations..."
npm run db:generate

# Run migrations
echo "🗄️  Running database migrations..."
npm run db:migrate

# Seed database
echo "🌱 Seeding database..."
npm run db:seed

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Demo credentials:"
echo "   Email: demo@example.com"
echo "   Password: password123"
echo ""
echo "🚀 Start the development server:"
echo "   npm run dev"
echo ""
echo "🌐 Then open http://localhost:3000"
