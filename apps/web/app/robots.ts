import type { MetadataRoute } from 'next';
import { SITE_ORIGIN } from '@/lib/site';

// output: export needs every route resolved at build time; these are pure functions over the exported json
export const dynamic = 'force-static';

// /admin is a static asset behind cloudflare access, and /s renders someone's submission by token:
// neither belongs in an index. everything else is the point of the site.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/s'] }],
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  };
}
