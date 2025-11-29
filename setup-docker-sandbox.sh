#!/bin/bash

# Docker Sandbox Setup Script
# Builds the base sandbox image and starts supporting services

set -e

echo "🐳 Docker Sandbox Setup"
echo "======================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo "❌ Error: Docker is not running"
  echo "Please start Docker Desktop and try again"
  exit 1
fi

echo "✅ Docker is running"

# Build the sandbox base image
echo ""
echo "📦 Building sandbox base image..."
docker build -f Dockerfile.sandbox -t nextjs-sandbox:latest .

echo ""
echo "✅ Sandbox image built successfully"

# Create sandbox network if it doesn't exist
echo ""
echo "🌐 Setting up Docker network..."
if ! docker network inspect sandbox-network > /dev/null 2>&1; then
  docker network create sandbox-network
  echo "✅ Created sandbox-network"
else
  echo "✅ Network sandbox-network already exists"
fi

# Start Traefik reverse proxy
echo ""
echo "🔀 Starting Traefik reverse proxy..."
docker-compose -f docker-compose.sandbox.yml up -d traefik

echo ""
echo "✅ Docker Sandbox Setup Complete!"
echo ""
echo "📝 Next steps:"
echo "1. Make sure your .env file has DOCKER_ENABLED=true"
echo "2. Start your Next.js app: npm run dev"
echo "3. Components will automatically run in Docker containers"
echo ""
echo "🌐 Traefik Dashboard: http://localhost:8081"
echo "🔗 Sandbox Preview Port Range: 3001-4000"
