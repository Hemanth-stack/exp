# Production Dockerfile for AI App Builder
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the application
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Install Docker CLI and git for container management and repository cloning
RUN apk add --no-cache docker-cli git

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Create public directory and copy if exists
RUN mkdir -p ./public

# Copy necessary files
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Copy public folder if it exists (use wildcard to make optional)
COPY --from=builder /app/public* ./public/

# Copy templates and drizzle for runtime
COPY --from=builder /app/templates ./templates
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts

# Create directories for user repos with proper permissions
RUN mkdir -p /app/user-repos && chown -R nextjs:nodejs /app/user-repos

# Note: For Docker socket access, we need to run as root
# The user can be changed in docker-compose with user: root
# Or properly configure docker group permissions on host

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
