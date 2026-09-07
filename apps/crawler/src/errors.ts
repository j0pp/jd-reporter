import { HttpError, RateLimitedError } from '@jdr/core';

export function describeError(e: unknown): string {
  if (e instanceof HttpError) return `http ${e.status}`;
  if (e instanceof RateLimitedError) return 'rate limited (breaker tripped)';
  if (e instanceof Error) return `${e.name}: ${e.message}`.slice(0, 200);
  return String(e).slice(0, 200);
}
