// the public origin, needed at build time for canonical urls, og tags, robots and the sitemap. the worker's
// PUBLIC_ORIGIN var is a runtime value the static export cannot see, so this is its build-time twin.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN ?? 'http://localhost:8787').replace(/\/$/, '');
