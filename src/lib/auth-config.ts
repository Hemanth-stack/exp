import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GitHubProvider from 'next-auth/providers/github';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

export const authOptions: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
      authorization: {
        params: {
          scope: 'read:user user:email repo',
        },
      },
    }),
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

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email))
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
  ],
  session: {
    strategy: 'jwt',
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

          // Check if user exists
          const [existingUser] = await db
            .select()
            .from(users)
            .where(eq(users.email, email))
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
              email,
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
          .where(eq(users.email, token.email as string))
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
