import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // API only: no "X-Powered-By" header.
  poweredByHeader: false,
  // `npm run build:deploy` makes a self-contained server bundle
  // (.next/standalone/server.js) for hosting such as cPanel's Node.js apps.
  // Normal builds keep `npm start`.
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
};

export default nextConfig;
