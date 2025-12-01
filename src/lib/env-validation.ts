/**
 * Environment Variables Validation
 * Validates required environment variables at startup
 */

export interface EnvValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

// Required environment variables for production
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'NEXTAUTH_SECRET',
  'NEXTAUTH_URL',
] as const;

// Required for specific features
const FEATURE_ENV_VARS = {
  github: ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'],
  ai: ['ANTHROPIC_API_KEY'],
  docker: ['HOST_USER_REPOS_PATH'],
  redis: ['REDIS_URL'],
} as const;

// Optional with warnings if missing in production
const RECOMMENDED_ENV_VARS = [
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'ANTHROPIC_API_KEY',
] as const;

/**
 * Check if an environment variable is set and non-empty
 */
function isEnvSet(key: string): boolean {
  const value = process.env[key];
  return value !== undefined && value !== '';
}

/**
 * Validate all required environment variables
 */
export function validateEnv(): EnvValidationResult {
  const missing: string[] = [];
  const warnings: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  // Check required vars
  for (const key of REQUIRED_ENV_VARS) {
    if (!isEnvSet(key)) {
      missing.push(key);
    }
  }

  // Check recommended vars (warn only in production)
  if (isProduction) {
    for (const key of RECOMMENDED_ENV_VARS) {
      if (!isEnvSet(key)) {
        warnings.push(`${key} is not set. Related features may not work.`);
      }
    }
  }

  // Check Docker vars in production
  if (isProduction && process.env.DOCKER_ENABLED === 'true') {
    for (const key of FEATURE_ENV_VARS.docker) {
      if (!isEnvSet(key)) {
        missing.push(key);
      }
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}

/**
 * Validate and throw if critical env vars are missing
 * Call this at application startup
 */
export function validateEnvOrThrow(): void {
  const result = validateEnv();

  if (!result.valid) {
    const errorMessage = [
      '❌ Missing required environment variables:',
      ...result.missing.map(key => `   - ${key}`),
      '',
      'Please set these variables in your .env file or environment.',
    ].join('\n');

    console.error(errorMessage);
    
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variables: ${result.missing.join(', ')}`);
    }
  }

  // Log warnings
  if (result.warnings.length > 0) {
    console.warn('⚠️  Environment warnings:');
    result.warnings.forEach(warning => console.warn(`   - ${warning}`));
  }
}

/**
 * Get a required environment variable or throw
 */
export function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default
 */
export function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

/**
 * Check if a feature is enabled based on its required env vars
 */
export function isFeatureEnabled(feature: keyof typeof FEATURE_ENV_VARS): boolean {
  const requiredVars = FEATURE_ENV_VARS[feature];
  return requiredVars.every(key => isEnvSet(key));
}
