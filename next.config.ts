import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `BUILD_DIST_DIR=.next-ci` lets the build test compile to an isolated
  // directory so `npm test` never clobbers a concurrently running dev server.
  ...(process.env.BUILD_DIST_DIR ? { distDir: process.env.BUILD_DIST_DIR } : {}),
};

export default nextConfig;
