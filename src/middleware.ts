import { withAuth } from 'next-auth/middleware';

export default withAuth({
  callbacks: {
    authorized: ({ token }) => !!token,
  },
  pages: {
    signIn: '/login',
  },
});

export const config = {
  matcher: [
    '/dashboard/:path*', 
    '/settings/:path*', 
    '/builder/:path*',
    '/api/projects/:path*',
    '/api/sandbox/:path*',
    '/api/containers/:path*',
  ],
};
