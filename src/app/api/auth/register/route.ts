import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit, createRateLimitHeaders, getRateLimitIdentifier, RATE_LIMITS } from '@/lib/rate-limit';

// Strong password validation
const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const registerSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .max(255, 'Email must be at most 255 characters')
    .transform(val => val.toLowerCase().trim()),
  password: passwordSchema,
  name: z.string()
    .min(2, 'Name must be at least 2 characters')
    .max(100, 'Name must be at most 100 characters')
    .regex(/^[a-zA-Z\s\-']+$/, 'Name can only contain letters, spaces, hyphens, and apostrophes')
    .transform(val => val.trim()),
});

export async function POST(request: NextRequest) {
  try {
    // Get IP for rate limiting (unauthenticated endpoint)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() 
      || request.headers.get('x-real-ip')
      || 'unknown';
    
    // Rate limiting (strict for registration to prevent abuse)
    const identifier = getRateLimitIdentifier(null, ip);
    const rateLimitResult = checkRateLimit(identifier, RATE_LIMITS.auth);
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { 
          status: 429,
          headers: createRateLimitHeaders(rateLimitResult)
        }
      );
    }

    const body = await request.json();
    const { email, password, name } = registerSchema.parse(body);

    // Check if user exists
    const [existingUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser) {
      // Don't reveal whether email exists (security best practice)
      // But we need to tell the user something helpful
      return NextResponse.json(
        { error: 'Unable to create account. Please try a different email or sign in.' },
        { status: 400 }
      );
    }

    // Hash password with higher cost factor for security
    const passwordHash = await bcrypt.hash(password, 12);

    // Create user
    await db
      .insert(users)
      .values({
        email,
        name,
        passwordHash,
      });

    // Don't return the user ID in production (security)
    return NextResponse.json(
      { message: 'User created successfully' },
      { 
        status: 201,
        headers: createRateLimitHeaders(rateLimitResult)
      }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.errors.map(e => e.message) },
        { status: 400 }
      );
    }

    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
