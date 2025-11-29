import { db } from './index';
import { users } from './schema';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding database...');

  // Create demo user
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  await db.insert(users).values([
    {
      email: 'demo@example.com',
      name: 'Demo User',
      passwordHash: hashedPassword,
      subscriptionTier: 'pro',
      maxProjects: 10,
    },
    {
      email: 'user@example.com',
      name: 'Test User',
      passwordHash: hashedPassword,
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
