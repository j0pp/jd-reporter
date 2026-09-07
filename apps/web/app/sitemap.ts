import type { MetadataRoute } from 'next';
import { getCompanies, getFindings, getSite } from '@/lib/data';
import { SITE_ORIGIN } from '@/lib/site';

// output: export needs every route resolved at build time; these are pure functions over the exported json
export const dynamic = 'force-static';

// built from the same exported json the pages read, so the sitemap can never list a page the build did not
// generate. /admin and /s are left out for the reasons in robots.ts
export default function sitemap(): MetadataRoute.Sitemap {
  const generatedAt = getSite().generatedAt ?? new Date().toISOString();
  const url = (path: string) => `${SITE_ORIGIN}${path}`;

  const staticPages: MetadataRoute.Sitemap = [
    { url: url('/'), lastModified: generatedAt, changeFrequency: 'daily', priority: 1 },
    { url: url('/methodology'), lastModified: generatedAt, changeFrequency: 'monthly', priority: 0.8 },
    { url: url('/law'), lastModified: generatedAt, changeFrequency: 'monthly', priority: 0.8 },
    { url: url('/dispute'), lastModified: generatedAt, changeFrequency: 'monthly', priority: 0.5 },
    { url: url('/submit'), lastModified: generatedAt, changeFrequency: 'monthly', priority: 0.5 },
  ];

  const companyPages: MetadataRoute.Sitemap = getCompanies().map((c) => ({
    url: url(`/c/${c.slug}`),
    lastModified: c.rollupAt ?? generatedAt,
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  const findingPages: MetadataRoute.Sitemap = getFindings().map((f) => ({
    url: url(`/p/${f.id}`),
    lastModified: f.publishedAt ?? f.detectedAt,
    changeFrequency: 'daily',
    priority: 0.6,
  }));

  return [...staticPages, ...companyPages, ...findingPages];
}
