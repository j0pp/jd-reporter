import type { D1Db } from '@jdr/db/d1';

export interface Bindings {
  DB: D1Database;
  BLOBS: R2Bucket;
  ASSETS: Fetcher;
  GITHUB_REPO: string;
  PUBLIC_ORIGIN: string;
  ADMIN_TOKEN?: string;
  TURNSTILE_SECRET?: string;
  GITHUB_TOKEN?: string;
  IP_SALT?: string;
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export interface Variables {
  db: D1Db;
  actor: string;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
