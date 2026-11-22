import type { NextConfig } from 'next';

const securityHeaders = [
  {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'X-Frame-Options', value: 'DENY'},
  {key: 'Referrer-Policy', value: 'no-referrer'},
  {key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()'},
  {key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"},
];

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'ioredis', 'pino', 'nodemailer'],
  experimental: { cpus: 2 },
  async headers() { return [{source: '/:path*', headers: securityHeaders}]; },
};
export default config;