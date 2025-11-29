#!/bin/bash

# Docker Sandbox Health Check Script
# Verifies all components are working correctly

echo "🏥 Docker Sandbox Health Check"
echo "=============================="
echo ""

# Track overall status
all_good=true

# Check 1: Docker running
echo "1️⃣ Checking Docker..."
if docker info > /dev/null 2>&1; then
  echo "   ✅ Docker is running"
  docker_version=$(docker --version)
  echo "   📦 $docker_version"
else
  echo "   ❌ Docker is not running"
  echo "   💡 Please start Docker Desktop"
  all_good=false
fi
echo ""

# Check 2: Docker image
echo "2️⃣ Checking sandbox base image..."
if docker images | grep -q "nextjs-sandbox"; then
  echo "   ✅ Base image exists"
  image_info=$(docker images nextjs-sandbox:latest --format "{{.Size}}")
  echo "   📦 Size: $image_info"
else
  echo "   ❌ Base image not found"
  echo "   💡 Run: npm run sandbox:build"
  all_good=false
fi
echo ""

# Check 3: Docker network
echo "3️⃣ Checking Docker network..."
if docker network ls | grep -q "sandbox-network"; then
  echo "   ✅ sandbox-network exists"
else
  echo "   ❌ Network not found"
  echo "   💡 Run: docker network create sandbox-network"
  all_good=false
fi
echo ""

# Check 4: Traefik container
echo "4️⃣ Checking Traefik reverse proxy..."
if docker ps | grep -q "sandbox-traefik"; then
  echo "   ✅ Traefik is running"
  traefik_port=$(docker port sandbox-traefik 80/tcp 2>/dev/null || echo "not exposed")
  echo "   🔗 Port: $traefik_port"
else
  echo "   ⚠️  Traefik is not running"
  echo "   💡 Run: npm run sandbox:start"
  # Not critical, so don't fail
fi
echo ""

# Check 5: Active sandbox containers
echo "5️⃣ Checking sandbox containers..."
sandbox_count=$(docker ps --filter "label=sandbox.session" --format "{{.Names}}" | wc -l | tr -d ' ')
if [ "$sandbox_count" -gt 0 ]; then
  echo "   📦 $sandbox_count active sandbox container(s)"
  docker ps --filter "label=sandbox.session" --format "   - {{.Names}} ({{.Status}})"
else
  echo "   ℹ️  No active sandbox containers"
fi
echo ""

# Check 6: Environment file
echo "6️⃣ Checking environment configuration..."
if [ -f ".env" ]; then
  echo "   ✅ .env file exists"
  
  if grep -q "DOCKER_ENABLED=true" .env; then
    echo "   ✅ DOCKER_ENABLED=true"
  else
    echo "   ⚠️  DOCKER_ENABLED is not set to true"
    all_good=false
  fi
  
  if grep -q "SANDBOX_BASE_IMAGE" .env; then
    base_image=$(grep "SANDBOX_BASE_IMAGE" .env | cut -d '=' -f2)
    echo "   📦 Base image: $base_image"
  fi
else
  echo "   ❌ .env file not found"
  echo "   💡 Copy from .env.example"
  all_good=false
fi
echo ""

# Check 7: Port availability
echo "7️⃣ Checking port availability..."
start_port=${DOCKER_CONTAINER_PORT_START:-3001}
check_port=$start_port

if lsof -Pi :$check_port -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "   ℹ️  Port $check_port is in use (might be a sandbox)"
else
  echo "   ✅ Port $check_port is available"
fi
echo ""

# Check 8: Node modules
echo "8️⃣ Checking dependencies..."
if [ -d "node_modules" ]; then
  echo "   ✅ node_modules exists"
  if [ -d "node_modules/dockerode" ]; then
    echo "   ✅ dockerode installed"
  else
    echo "   ❌ dockerode not found"
    echo "   💡 Run: npm install"
    all_good=false
  fi
else
  echo "   ❌ node_modules not found"
  echo "   💡 Run: npm install"
  all_good=false
fi
echo ""

# Check 9: Sandbox template
echo "9️⃣ Checking sandbox template..."
if [ -d "sandbox-template" ]; then
  echo "   ✅ sandbox-template directory exists"
  if [ -f "sandbox-template/package.json" ]; then
    echo "   ✅ Template package.json exists"
  else
    echo "   ❌ Template package.json missing"
    all_good=false
  fi
else
  echo "   ❌ sandbox-template directory not found"
  all_good=false
fi
echo ""

# Check 10: API endpoints (if app is running)
echo "🔟 Checking API endpoints (if app is running)..."
if curl -s http://localhost:3000/api/sandbox/status > /dev/null 2>&1; then
  echo "   ✅ Application is running"
  
  # Check Docker status endpoint
  status=$(curl -s http://localhost:3000/api/sandbox/status)
  if echo "$status" | grep -q "available"; then
    echo "   ✅ Sandbox API is responding"
    if echo "$status" | grep -q '"available":true'; then
      echo "   ✅ Docker is available via API"
    fi
  fi
else
  echo "   ℹ️  Application is not running"
  echo "   💡 Start with: npm run dev"
fi
echo ""

# Summary
echo "=============================="
if [ "$all_good" = true ]; then
  echo "✅ All critical checks passed!"
  echo ""
  echo "🚀 Your Docker sandbox system is ready!"
  echo ""
  echo "Next steps:"
  echo "  1. Start your app: npm run dev"
  echo "  2. Visit demo: http://localhost:3000/sandbox-demo"
  echo "  3. Check Traefik: http://localhost:8081"
else
  echo "⚠️  Some issues were found"
  echo ""
  echo "Please fix the issues above and run this check again."
  echo ""
  echo "Common fixes:"
  echo "  • Start Docker Desktop"
  echo "  • Run: npm run sandbox:setup"
  echo "  • Run: npm install"
  echo "  • Create .env from .env.example"
fi
echo "=============================="
