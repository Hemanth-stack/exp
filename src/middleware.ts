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
    '/sandbox/:path*',
    // API routes that need auth (excluding preview proxy which handles its own)
    '/api/projects/:projectId',
    '/api/projects/:projectId/chat/:path*',
    '/api/projects/:projectId/files/:path*',
    '/api/projects/:projectId/git/:path*',
    '/api/projects/:projectId/github/:path*',
    '/api/projects/:projectId/deploy/:path*',
    '/api/projects/:projectId/exec/:path*',
    // Preview routes - the main preview endpoint needs auth, but proxy handles its own
    '/api/projects/:projectId/preview',
    '/api/sandbox/:path*',
    '/api/containers/:path*',
    '/api/github/:path*',
  ],
};
