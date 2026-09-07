import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema.ts';

// inside the worker: the binding
export function createD1Db(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type D1Db = ReturnType<typeof createD1Db>;
