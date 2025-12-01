# ============================================
# AI App Builder - Makefile
# ============================================
# Usage: make <command>
# Run 'make help' to see all available commands
# ============================================

.PHONY: help install dev build start stop clean docker-build docker-up docker-down docker-logs deploy prod-build prod-start setup db-migrate db-seed redis-start redis-stop

# Default target
.DEFAULT_GOAL := help

# Colors for terminal output
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
NC := \033[0m # No Color

# ============================================
# HELP
# ============================================
help: ## Show this help message
	@echo ""
	@echo "$(BLUE)AI App Builder - Available Commands$(NC)"
	@echo "======================================"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "$(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
	@echo ""

# ============================================
# DEVELOPMENT
# ============================================
install: ## Install all dependencies
	@echo "$(BLUE)Installing dependencies...$(NC)"
	npm install
	@echo "$(GREEN)✓ Dependencies installed$(NC)"

dev: ## Start development server
	@echo "$(BLUE)Starting development server...$(NC)"
	npm run dev

build: ## Build the application
	@echo "$(BLUE)Building application...$(NC)"
	npm run build
	@echo "$(GREEN)✓ Build complete$(NC)"

start: ## Start the production server (after build)
	@echo "$(BLUE)Starting production server...$(NC)"
	npm run start

lint: ## Run ESLint
	@echo "$(BLUE)Running linter...$(NC)"
	npm run lint

typecheck: ## Run TypeScript type checking
	@echo "$(BLUE)Running type check...$(NC)"
	npx tsc --noEmit

# ============================================
# DATABASE
# ============================================
db-generate: ## Generate database migrations
	@echo "$(BLUE)Generating database migrations...$(NC)"
	npx drizzle-kit generate
	@echo "$(GREEN)✓ Migrations generated$(NC)"

db-migrate: ## Run database migrations
	@echo "$(BLUE)Running database migrations...$(NC)"
	npx drizzle-kit migrate
	@echo "$(GREEN)✓ Migrations complete$(NC)"

db-push: ## Push schema changes to database
	@echo "$(BLUE)Pushing schema to database...$(NC)"
	npx drizzle-kit push
	@echo "$(GREEN)✓ Schema pushed$(NC)"

db-seed: ## Seed the database
	@echo "$(BLUE)Seeding database...$(NC)"
	npx ts-node src/db/seed.ts
	@echo "$(GREEN)✓ Database seeded$(NC)"

db-studio: ## Open Drizzle Studio
	@echo "$(BLUE)Opening Drizzle Studio...$(NC)"
	npx drizzle-kit studio

# ============================================
# REDIS
# ============================================
redis-start: ## Start Redis server (local)
	@echo "$(BLUE)Starting Redis server...$(NC)"
	redis-server --daemonize yes
	@echo "$(GREEN)✓ Redis started$(NC)"

redis-stop: ## Stop Redis server (local)
	@echo "$(BLUE)Stopping Redis server...$(NC)"
	redis-cli shutdown || true
	@echo "$(GREEN)✓ Redis stopped$(NC)"

redis-cli: ## Open Redis CLI
	@echo "$(BLUE)Opening Redis CLI...$(NC)"
	redis-cli

redis-flush: ## Flush all Redis data
	@echo "$(YELLOW)Flushing all Redis data...$(NC)"
	redis-cli FLUSHALL
	@echo "$(GREEN)✓ Redis flushed$(NC)"

# ============================================
# DOCKER - DEVELOPMENT
# ============================================
docker-build: ## Build Docker images
	@echo "$(BLUE)Building Docker images...$(NC)"
	docker-compose build
	@echo "$(GREEN)✓ Docker images built$(NC)"

docker-up: ## Start Docker containers (detached)
	@echo "$(BLUE)Starting Docker containers...$(NC)"
	docker-compose up -d
	@echo "$(GREEN)✓ Docker containers started$(NC)"

docker-down: ## Stop Docker containers
	@echo "$(BLUE)Stopping Docker containers...$(NC)"
	docker-compose down
	@echo "$(GREEN)✓ Docker containers stopped$(NC)"

docker-logs: ## View Docker container logs
	@echo "$(BLUE)Viewing Docker logs...$(NC)"
	docker-compose logs -f

docker-ps: ## List running Docker containers
	docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

docker-clean: ## Remove all stopped containers and unused images
	@echo "$(YELLOW)Cleaning Docker resources...$(NC)"
	docker system prune -f
	@echo "$(GREEN)✓ Docker cleaned$(NC)"

# ============================================
# DOCKER - SANDBOX
# ============================================
sandbox-build: ## Build the sandbox Docker image
	@echo "$(BLUE)Building sandbox Docker image...$(NC)"
	docker build -f Dockerfile.sandbox -t nextjs-sandbox:latest .
	@echo "$(GREEN)✓ Sandbox image built$(NC)"

sandbox-check: ## Check sandbox Docker setup
	@echo "$(BLUE)Checking sandbox setup...$(NC)"
	./check-docker-sandbox.sh

sandbox-setup: ## Set up Docker sandbox environment
	@echo "$(BLUE)Setting up Docker sandbox...$(NC)"
	./setup-docker-sandbox.sh
	@echo "$(GREEN)✓ Sandbox setup complete$(NC)"

# ============================================
# PRODUCTION DEPLOYMENT
# ============================================
prod-check: ## Check production requirements
	@echo "$(BLUE)Checking production requirements...$(NC)"
	@command -v node >/dev/null 2>&1 || { echo "$(RED)✗ Node.js is required$(NC)"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "$(RED)✗ Docker is required$(NC)"; exit 1; }
	@command -v redis-cli >/dev/null 2>&1 || { echo "$(RED)✗ Redis is required$(NC)"; exit 1; }
	@[ -f .env ] || { echo "$(RED)✗ .env file is required$(NC)"; exit 1; }
	@echo "$(GREEN)✓ All requirements met$(NC)"

prod-build: prod-check ## Build for production
	@echo "$(BLUE)Building for production...$(NC)"
	NODE_ENV=production npm run build
	@echo "$(GREEN)✓ Production build complete$(NC)"

prod-start: ## Start production server
	@echo "$(BLUE)Starting production server...$(NC)"
	NODE_ENV=production npm run start

prod-deploy: ## Full production deployment
	@echo "$(BLUE)Starting production deployment...$(NC)"
	@echo ""
	@echo "Step 1/6: Checking requirements..."
	@$(MAKE) prod-check
	@echo ""
	@echo "Step 2/6: Installing dependencies..."
	@$(MAKE) install
	@echo ""
	@echo "Step 3/6: Running database migrations..."
	@$(MAKE) db-push
	@echo ""
	@echo "Step 4/6: Building sandbox image..."
	@$(MAKE) sandbox-build
	@echo ""
	@echo "Step 5/6: Building application..."
	@$(MAKE) prod-build
	@echo ""
	@echo "Step 6/6: Starting services..."
	@$(MAKE) prod-start
	@echo ""
	@echo "$(GREEN)✓ Production deployment complete!$(NC)"

# ============================================
# DOCKER COMPOSE - PRODUCTION
# ============================================
prod-docker-build: ## Build production Docker images
	@echo "$(BLUE)Building production Docker images...$(NC)"
	docker-compose -f docker-compose.prod.yml build
	docker build -f Dockerfile.sandbox -t nextjs-sandbox:latest .
	@echo "$(GREEN)✓ Production images built$(NC)"

prod-docker-up: ## Start production containers
	@echo "$(BLUE)Starting production containers...$(NC)"
	docker-compose -f docker-compose.prod.yml up -d
	@echo "$(GREEN)✓ Production containers started$(NC)"
	@echo ""
	@echo "$(YELLOW)Application running at: http://localhost:3000$(NC)"

prod-docker-down: ## Stop production containers
	@echo "$(BLUE)Stopping production containers...$(NC)"
	docker-compose -f docker-compose.prod.yml down
	@echo "$(GREEN)✓ Production containers stopped$(NC)"

prod-docker-logs: ## View production logs
	docker-compose -f docker-compose.prod.yml logs -f

prod-docker-logs-app: ## View only app logs
	docker-compose -f docker-compose.prod.yml logs -f app

prod-docker-restart: ## Restart production containers
	@echo "$(BLUE)Restarting production containers...$(NC)"
	docker-compose -f docker-compose.prod.yml restart
	@echo "$(GREEN)✓ Production containers restarted$(NC)"

prod-docker-deploy: ## Full Docker production deployment
	@echo "$(BLUE)Starting Docker production deployment...$(NC)"
	@echo ""
	@echo "Step 1/4: Building sandbox image..."
	@$(MAKE) sandbox-build
	@echo ""
	@echo "Step 2/4: Building production images..."
	@$(MAKE) prod-docker-build
	@echo ""
	@echo "Step 3/4: Starting containers..."
	@$(MAKE) prod-docker-up
	@echo ""
	@echo "Step 4/4: Waiting for services to be ready..."
	@sleep 10
	@echo ""
	@echo "$(GREEN)✓ Docker production deployment complete!$(NC)"
	@echo ""
	@echo "$(YELLOW)Application running at: http://localhost:3000$(NC)"
	@echo "$(YELLOW)Database running at: localhost:5433$(NC)"
	@echo "$(YELLOW)Redis running at: localhost:6379$(NC)"

prod-docker-status: ## Show production container status
	@echo "$(BLUE)Production Container Status$(NC)"
	@echo "============================"
	docker-compose -f docker-compose.prod.yml ps

# ============================================
# CLEANUP
# ============================================
clean: ## Clean build artifacts
	@echo "$(YELLOW)Cleaning build artifacts...$(NC)"
	rm -rf .next
	rm -rf node_modules/.cache
	@echo "$(GREEN)✓ Clean complete$(NC)"

clean-all: clean ## Clean everything including node_modules
	@echo "$(YELLOW)Cleaning all files...$(NC)"
	rm -rf node_modules
	rm -rf .next
	@echo "$(GREEN)✓ Full clean complete$(NC)"

clean-containers: ## Stop and remove all preview containers
	@echo "$(YELLOW)Cleaning preview containers...$(NC)"
	docker ps -a --filter "name=preview-" -q | xargs -r docker rm -f
	@echo "$(GREEN)✓ Preview containers cleaned$(NC)"

# ============================================
# UTILITIES
# ============================================
env-check: ## Check environment variables
	@echo "$(BLUE)Checking environment variables...$(NC)"
	@[ -f .env ] && echo "$(GREEN)✓ .env file exists$(NC)" || echo "$(RED)✗ .env file missing$(NC)"
	@grep -q "DATABASE_URL" .env 2>/dev/null && echo "$(GREEN)✓ DATABASE_URL is set$(NC)" || echo "$(RED)✗ DATABASE_URL not set$(NC)"
	@grep -q "NEXTAUTH_SECRET" .env 2>/dev/null && echo "$(GREEN)✓ NEXTAUTH_SECRET is set$(NC)" || echo "$(RED)✗ NEXTAUTH_SECRET not set$(NC)"
	@grep -q "REDIS_URL" .env 2>/dev/null && echo "$(GREEN)✓ REDIS_URL is set$(NC)" || echo "$(RED)✗ REDIS_URL not set$(NC)"
	@grep -q "GITHUB_CLIENT_ID" .env 2>/dev/null && echo "$(GREEN)✓ GITHUB_CLIENT_ID is set$(NC)" || echo "$(RED)✗ GITHUB_CLIENT_ID not set$(NC)"

setup: ## Initial project setup
	@echo "$(BLUE)Running initial setup...$(NC)"
	@echo ""
	@echo "Step 1/5: Copying environment file..."
	@[ -f .env ] || cp .env.example .env
	@echo "$(GREEN)✓ Environment file ready$(NC)"
	@echo ""
	@echo "Step 2/5: Installing dependencies..."
	@$(MAKE) install
	@echo ""
	@echo "Step 3/5: Setting up database..."
	@$(MAKE) db-push
	@echo ""
	@echo "Step 4/5: Building sandbox image..."
	@$(MAKE) sandbox-build
	@echo ""
	@echo "Step 5/5: Running build..."
	@$(MAKE) build
	@echo ""
	@echo "$(GREEN)✓ Setup complete!$(NC)"
	@echo ""
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "  1. Edit .env file with your credentials"
	@echo "  2. Run 'make dev' to start development server"
	@echo "  3. Run 'make prod-deploy' for production deployment"

status: ## Show system status
	@echo "$(BLUE)System Status$(NC)"
	@echo "=============="
	@echo ""
	@echo "Node.js: $$(node --version 2>/dev/null || echo 'Not installed')"
	@echo "npm: $$(npm --version 2>/dev/null || echo 'Not installed')"
	@echo "Docker: $$(docker --version 2>/dev/null || echo 'Not installed')"
	@echo "Redis: $$(redis-cli --version 2>/dev/null || echo 'Not installed')"
	@echo ""
	@echo "Docker Containers:"
	@docker ps --format "  {{.Names}}: {{.Status}}" 2>/dev/null || echo "  Docker not running"
	@echo ""
	@echo "Preview Containers:"
	@docker ps --filter "name=preview-" --format "  {{.Names}}: {{.Status}}" 2>/dev/null || echo "  None running"

logs: ## Show application logs (if using PM2)
	@echo "$(BLUE)Application logs...$(NC)"
	@if command -v pm2 >/dev/null 2>&1; then \
		pm2 logs; \
	else \
		echo "PM2 not installed. Use 'npm run start' to see logs."; \
	fi

# ============================================
# PM2 (Process Manager for Production)
# ============================================
pm2-install: ## Install PM2 globally
	@echo "$(BLUE)Installing PM2...$(NC)"
	npm install -g pm2
	@echo "$(GREEN)✓ PM2 installed$(NC)"

pm2-start: prod-build ## Start with PM2
	@echo "$(BLUE)Starting with PM2...$(NC)"
	pm2 start npm --name "ai-app-builder" -- start
	@echo "$(GREEN)✓ Started with PM2$(NC)"

pm2-stop: ## Stop PM2 process
	@echo "$(BLUE)Stopping PM2 process...$(NC)"
	pm2 stop ai-app-builder
	@echo "$(GREEN)✓ PM2 process stopped$(NC)"

pm2-restart: ## Restart PM2 process
	@echo "$(BLUE)Restarting PM2 process...$(NC)"
	pm2 restart ai-app-builder
	@echo "$(GREEN)✓ PM2 process restarted$(NC)"

pm2-logs: ## View PM2 logs
	pm2 logs ai-app-builder

pm2-status: ## View PM2 status
	pm2 status

pm2-save: ## Save PM2 process list
	pm2 save
	@echo "$(GREEN)✓ PM2 process list saved$(NC)"

pm2-startup: ## Setup PM2 startup script
	pm2 startup
	@echo "$(YELLOW)Run the command above with sudo$(NC)"
