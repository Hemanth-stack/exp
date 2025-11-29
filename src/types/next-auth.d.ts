import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      subscriptionTier: string;
      maxProjects: number;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    email: string;
    name: string;
    subscriptionTier: string;
    maxProjects: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    subscriptionTier: string;
    maxProjects: number;
  }
}
