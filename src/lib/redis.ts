/**
 * Redis Client Service
 * Centralized Redis connection for state management
 */

import { createClient, RedisClientType } from 'redis';

let redisClient: RedisClientType | null = null;
let isConnecting = false;
let connectionPromise: Promise<RedisClientType> | null = null;

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Get or create Redis client connection
 */
export async function getRedisClient(): Promise<RedisClientType> {
  // Return existing connected client
  if (redisClient?.isOpen) {
    return redisClient;
  }

  // If already connecting, wait for that connection
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  // Start new connection
  isConnecting = true;
  connectionPromise = connectRedis();

  try {
    redisClient = await connectionPromise;
    return redisClient;
  } finally {
    isConnecting = false;
    connectionPromise = null;
  }
}

async function connectRedis(): Promise<RedisClientType> {
  const client = createClient({
    url: REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          console.error('[Redis] Max reconnection attempts reached');
          return new Error('Max reconnection attempts reached');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  client.on('error', (err) => {
    console.error('[Redis] Client error:', err.message);
  });

  client.on('connect', () => {
    console.log('[Redis] Connected to Redis server');
  });

  client.on('reconnecting', () => {
    console.log('[Redis] Reconnecting to Redis server...');
  });

  await client.connect();
  return client as RedisClientType;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedisConnection(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
    console.log('[Redis] Connection closed');
  }
}

/**
 * Check if Redis is available
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const client = await getRedisClient();
    await client.ping();
    return true;
  } catch {
    return false;
  }
}

// Redis key prefixes for different data types
export const REDIS_KEYS = {
  // Preview container state: preview:container:{projectId}
  PREVIEW_CONTAINER: (projectId: string) => `preview:container:${projectId}`,
  
  // User's active containers: preview:user:{userId}:containers (Set)
  USER_CONTAINERS: (userId: string) => `preview:user:${userId}:containers`,
  
  // Port allocation: preview:ports (Set of used ports)
  USED_PORTS: 'preview:ports',
  
  // Sandbox container state: sandbox:container:{sessionId}
  SANDBOX_CONTAINER: (sessionId: string) => `sandbox:container:${sessionId}`,
  
  // User's active sandboxes: sandbox:user:{userId}:sessions (Set)
  USER_SANDBOXES: (userId: string) => `sandbox:user:${userId}:sessions`,
} as const;

// Container limits from environment
export const CONTAINER_LIMITS = {
  MAX_CONTAINERS_PER_USER: parseInt(process.env.MAX_CONTAINERS_PER_USER || '6'),
  CONTAINER_TIMEOUT_MINUTES: parseInt(process.env.CONTAINER_TIMEOUT_MINUTES || '30'),
} as const;
