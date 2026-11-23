import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // App Router, TS strict; keep deps minimal (no experimental flags needed for P1)
  experimental: {
    serverActions: { bodySizeLimit: '1mb' },
  },
};

export default nextConfig;
