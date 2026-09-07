import type { NextConfig } from 'next';

// fully static: the worker serves out/ as assets and the daily crawl rebuilds it
const config: NextConfig = {
  output: 'export',
  trailingSlash: false,
  images: { unoptimized: true },
  transpilePackages: ['@jdr/core'],
  reactStrictMode: true,
};

export default config;
