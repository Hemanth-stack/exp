/**
 * Rate Limiting Utility
 * Simple in-memory rate limiter for API routes
 * In production, use Redis-based rate limiting
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store (use Redis in production for multi-instance support)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in seconds */
  windowSeconds: number;
  /** Optional key prefix for different rate limit buckets */
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

/**
 * Default rate limit configurations for different endpoints
 */
export const RATE_LIMITS = {
  // AI endpoints - expensive, strict limits
  ai: {
    maxRequests: 20,
    windowSeconds: 60, // 20 requests per minute
    keyPrefix: 'ai',
  },
  // Standard API endpoints
  api: {
    maxRequests: 100,
    windowSeconds: 60, // 100 requests per minute
    keyPrefix: 'api',
  },
  // Auth endpoints - prevent brute force
  auth: {
    maxRequests: 10,
    windowSeconds: 60, // 10 attempts per minute
    keyPrefix: 'auth',
  },
  // GitHub operations
  github: {
    maxRequests: 30,
    windowSeconds: 60, // 30 requests per minute
    keyPrefix: 'github',
  },
  // File operations
  files: {
    maxRequests: 60,
    windowSeconds: 60, // 60 requests per minute
    keyPrefix: 'files',
  },
} as const;

/**
 * Check rate limit for a given identifier
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const key = config.keyPrefix ? `${config.keyPrefix}:${identifier}` : identifier;
  const windowMs = config.windowSeconds * 1000;

  let entry = rateLimitStore.get(key);

  // Create new entry if doesn't exist or window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  // Increment count
  entry.count++;

  const allowed = entry.count <= config.maxRequests;
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const retryAfterSeconds = allowed ? undefined : Math.ceil((entry.resetAt - now) / 1000);

  return {
    allowed,
    remaining,
    resetAt: entry.resetAt,
    retryAfterSeconds,
  };
}

/**
 * Create rate limit headers for response
 */
export function createRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
  };

  if (result.retryAfterSeconds) {
    headers['Retry-After'] = result.retryAfterSeconds.toString();
  }

  return headers;
}

/**
 * Get user identifier from request
 * Uses user ID if authenticated, falls back to IP
 */
export function getRateLimitIdentifier(
  userId?: string | null,
  ip?: string | null
): string {
  if (userId) {
    return `user:${userId}`;
  }
  return `ip:${ip || 'unknown'}`;
}
