import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from './env.ts';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

// two ways in: a cloudflare access jwt (production, custom domain) or a bearer token (local dev, or before
// the domain exists). neither configured means the admin api is off, not open.
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { CF_ACCESS_TEAM_DOMAIN, CF_ACCESS_AUD, ADMIN_TOKEN } = c.env;

  if (CF_ACCESS_TEAM_DOMAIN && CF_ACCESS_AUD) {
    const token = c.req.header('cf-access-jwt-assertion');
    if (token) {
      try {
        const url = `https://${CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`;
        let jwks = jwksCache.get(url);
        if (!jwks) {
          jwks = createRemoteJWKSet(new URL(url));
          jwksCache.set(url, jwks);
        }
        const { payload } = await jwtVerify(token, jwks, { audience: CF_ACCESS_AUD, issuer: `https://${CF_ACCESS_TEAM_DOMAIN}.cloudflareaccess.com` });
        c.set('actor', String(payload.email ?? payload.sub ?? 'access-user'));
        return next();
      } catch {
        return c.json({ error: 'access token rejected' }, 401);
      }
    }
  }

  if (ADMIN_TOKEN) {
    const auth = c.req.header('authorization') ?? '';
    const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (presented && timingSafeEqual(presented, ADMIN_TOKEN)) {
      c.set('actor', 'admin');
      return next();
    }
    return c.json({ error: 'unauthorized' }, 401);
  }

  return c.json({ error: 'admin is not configured on this deployment' }, 503);
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
