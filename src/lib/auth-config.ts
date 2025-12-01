import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

// Validate GitHub OAuth configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// Check if GitHub OAuth is properly configured
const isGitHubConfigured = !!(GITHUB_CLIENT_ID && GITHUB_CLIENT_SECRET);

if (!isGitHubConfigured && process.env.NODE_ENV === 'production') {
  console.warn('[Auth] GitHub OAuth is not configured. GitHub login will be disabled.');
}

// Build providers array dynamically based on configuration
const providers: NextAuthOptions['providers'] = [
  CredentialsProvider({
    name: 'Credentials',
    credentials: {
      email: { label: 'Email', type: 'email' },
      password: { label: 'Password', type: 'password' },
    },
    async authorize(credentials) {
      if (!credentials?.email || !credentials?.password) {
        return null;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(credentials.email)) {
        return null;
      }

      // Limit email length to prevent abuse
      if (credentials.email.length > 255) {
        return null;
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, credentials.email.toLowerCase().trim()))
        .limit(1);

      if (!user || !user.passwordHash) {
        return null;
      }

      const isValid = await bcrypt.compare(credentials.password, user.passwordHash);

      if (!isValid) {
        return null;
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        subscriptionTier: user.subscriptionTier,
        maxProjects: user.maxProjects,
        githubAccessToken: user.githubAccessToken,
        githubUsername: user.githubUsername,
      };
    },
  }),
];

// Only add GitHub provider if properly configured
if (isGitHubConfigured) {
  providers.unshift(
    GitHubProvider({
      clientId: GITHUB_CLIENT_ID!,
      clientSecret: GITHUB_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'read:user user:email repo',
        },
      },
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'github') {
        try {
          const githubProfile = profile as { login?: string; id?: number };
          const email = user.email;
          
          if (!email) return false;

          // Validate email format
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(email)) {
            console.error('[Auth] Invalid email from GitHub OAuth');
            return false;
          }

          // Validate GitHub username
          const githubUsername = githubProfile.login;
          if (githubUsername && !/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(githubUsername)) {
            console.error('[Auth] Invalid GitHub username format');
            return false;
          }

          // Check if user exists
          const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, email.toLowerCase()))
            .limit(1);

          if (existingUser) {
            // Update GitHub token
            await db
              .update(users)
              .set({
                githubId: String(githubProfile.id),
                githubUsername: githubProfile.login,
                githubAccessToken: account.access_token,
              })
              .where(eq(users.id, existingUser.id));
          } else {
            // Create new user
            await db.insert(users).values({
              email: email.toLowerCase(),
              name: user.name || githubProfile.login || 'GitHub User',
              githubId: String(githubProfile.id),
              githubUsername: githubProfile.login,
              githubAccessToken: account.access_token,
            });
          }
          return true;
        } catch (error) {
          console.error('Error during GitHub sign in:', error);
          return false;
        }
      }
      return true;
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id;
        token.subscriptionTier = user.subscriptionTier;
        token.maxProjects = user.maxProjects;
        token.githubAccessToken = user.githubAccessToken || undefined;
        token.githubUsername = user.githubUsername || undefined;
      }
      
      // For GitHub OAuth, fetch user from DB to get their ID
      if (account?.provider === 'github' && token.email) {
        const [dbUser] = await db
          .select()
          .from(users)
          .where(eq(users.email, (token.email as string).toLowerCase()))
          .limit(1);
        
        if (dbUser) {
          token.id = dbUser.id;
          token.subscriptionTier = dbUser.subscriptionTier;
          token.maxProjects = dbUser.maxProjects;
          token.githubAccessToken = account.access_token;
          token.githubUsername = dbUser.githubUsername || undefined;
        }
      }
      
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.subscriptionTier = token.subscriptionTier as string;
        session.user.maxProjects = token.maxProjects as number;
        session.user.githubAccessToken = token.githubAccessToken as string | undefined;
        session.user.githubUsername = token.githubUsername as string | undefined;
      }
      return session;
    },
  },
};
