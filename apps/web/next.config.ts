import { existsSync } from 'node:fs';
import type { NextConfig } from 'next';

// Local dev: secrets live in the repo-root .env (one file for CLI, bench and web). On Vercel they come from the dashboard.
const rootEnv = new URL('../../.env', import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config: NextConfig = {
  // e2e builds use their own dir so they never collide with a running `next dev`
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  // workspace packages ship TypeScript source
  transpilePackages: ['@ai-mafia/engine', '@ai-mafia/agents'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default config;
