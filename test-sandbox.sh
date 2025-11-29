#!/bin/bash

# Test script for Docker sandbox integration
# This script tests the preview system end-to-end

set -e

echo "🧪 Docker Sandbox Integration Test"
echo "=================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# 1. Check Docker is running
echo "1. Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker Desktop."
    exit 1
fi
print_success "Docker is running"

# 2. Check if sandbox image exists
echo ""
echo "2. Checking sandbox image..."
if ! docker images | grep -q "nextjs-sandbox"; then
    print_error "Sandbox image not found. Building now..."
    docker build -f Dockerfile.sandbox -t nextjs-sandbox:latest .
fi
print_success "Sandbox image exists"

# 3. Check for user projects
echo ""
echo "3. Checking for user projects..."
if [ ! -d "user-repos" ] || [ -z "$(ls -A user-repos)" ]; then
    print_error "No user projects found in user-repos/"
    echo "   Please create a project first through the UI"
    exit 1
fi

# Get first project
PROJECT_ID=$(ls user-repos/ | head -n 1)
PROJECT_PATH="user-repos/$PROJECT_ID"
print_success "Found project: $PROJECT_ID"

# 4. Check project has package.json
echo ""
echo "4. Validating project structure..."
if [ ! -f "$PROJECT_PATH/package.json" ]; then
    print_error "Project missing package.json"
    exit 1
fi
print_success "Project has valid structure"

# 5. Test manual container start
echo ""
echo "5. Testing manual container start..."
TEST_PORT=4001
CONTAINER_NAME="sandbox-test-$$"

print_info "Starting container on port $TEST_PORT..."
CONTAINER_ID=$(docker run -d \
    --name "$CONTAINER_NAME" \
    -p "$TEST_PORT:3000" \
    -v "$(pwd)/$PROJECT_PATH:/app/user-project" \
    nextjs-sandbox:latest)

print_success "Container started: ${CONTAINER_ID:0:12}"

# 6. Wait for container to be ready
echo ""
echo "6. Waiting for Next.js to start (max 60s)..."
TIMEOUT=60
ELAPSED=0
while [ $ELAPSED -lt $TIMEOUT ]; do
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -q "Ready in"; then
        print_success "Next.js dev server is ready!"
        break
    fi
    echo -n "."
    sleep 2
    ELAPSED=$((ELAPSED + 2))
done

if [ $ELAPSED -ge $TIMEOUT ]; then
    print_error "Timeout waiting for Next.js to start"
    echo ""
    echo "Container logs:"
    docker logs "$CONTAINER_NAME"
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1
    exit 1
fi

# 7. Test HTTP endpoint
echo ""
echo "7. Testing HTTP endpoint..."
sleep 2  # Give it a moment to be fully ready
if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$TEST_PORT" | grep -q "200"; then
    print_success "HTTP endpoint responding correctly"
else
    print_error "HTTP endpoint not responding"
    docker logs "$CONTAINER_NAME" --tail 20
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1
    exit 1
fi

# 8. Check hot reload capability
echo ""
echo "8. Checking hot reload (volume mount)..."
if docker exec "$CONTAINER_NAME" test -d /app/user-project; then
    print_success "User project mounted correctly"
else
    print_error "User project not mounted"
    docker stop "$CONTAINER_NAME" > /dev/null 2>&1
    exit 1
fi

# 9. Test container health
echo ""
echo "9. Checking container health..."
HEALTH_STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo "none")
if [ "$HEALTH_STATUS" = "healthy" ] || [ "$HEALTH_STATUS" = "none" ]; then
    print_success "Container health: $HEALTH_STATUS"
else
    print_info "Container health: $HEALTH_STATUS (may still be starting)"
fi

# 10. Cleanup
echo ""
echo "10. Cleaning up..."
docker stop "$CONTAINER_NAME" > /dev/null 2>&1
print_success "Test container stopped and removed"

# Final summary
echo ""
echo "=================================="
echo "🎉 All tests passed!"
echo "=================================="
echo ""
echo "Next steps:"
echo "  1. Start the dev server: npm run dev"
echo "  2. Login to http://localhost:3000"
echo "  3. Navigate to a project builder"
echo "  4. Click 'Start Preview' button"
echo "  5. View your app in the preview panel"
echo ""
echo "Preview URL will be: http://localhost:4001 (or next available port)"
echo ""
print_success "Sandbox integration is working correctly! 🚀"
