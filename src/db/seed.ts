import { db } from './index';
import { users } from './schema';
import bcrypt from 'bcryptjs';

async function main() {
  // Don't run seed in production unless explicitly allowed
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
    console.error('❌ Seed is disabled in production. Set ALLOW_SEED=true to override.');
    process.exit(1);
  }

  console.log('Seeding database...');

  // Use environment variables for passwords in production, or defaults for development
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'demo-password-change-me';
  const userPassword = process.env.SEED_USER_PASSWORD || 'user-password-change-me';
  
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_DEMO_PASSWORD) {
    console.warn('⚠️  Warning: Using default passwords. Set SEED_DEMO_PASSWORD and SEED_USER_PASSWORD for production.');
  }

  // Create demo user
  const hashedDemoPassword = await bcrypt.hash(demoPassword, 12);
  const hashedUserPassword = await bcrypt.hash(userPassword, 12);
  
  await db.insert(users).values([
    {
      email: 'demo@example.com',
      name: 'Demo User',
      passwordHash: hashedDemoPassword,
      subscriptionTier: 'pro',
      maxProjects: 10,
    },
    {
      email: 'user@example.com',
      name: 'Test User',
      passwordHash: hashedUserPassword,
      subscriptionTier: 'free',
      maxProjects: 3,
    },
  ]);

  console.log('Seeding complete!');
  process.exit(0);
}

main().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
