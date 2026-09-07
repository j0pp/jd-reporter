import { describe, expect, it } from 'vitest';
import { ashby } from '../src/ats/ashby.ts';
import { greenhouse } from '../src/ats/greenhouse.ts';
import { cleanName, fetchIdentity } from '../src/ats/identity.ts';
import { lever } from '../src/ats/lever.ts';
import type { HttpClient } from '../src/http.ts';
import { workday } from '../src/ats/workday.ts';

// snippets taken from the live board pages on 2026-09-06
const GH = `<html><head>
<meta property="og:image" content="https://s2-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/307/500/original/SEO_No_tagline_Red.png?1643913593"/>
<title>Jobs at SEO (Sponsors for Educational Opportunity)</title>
<meta property="og:title" content="SEO (Sponsors for Educational Opportunity)"/>
</head><body><img src="https://s2-recruiting.cdn.greenhouse.io/.../SEO_No_tagline_Red.png" alt="SEO Logo" class="logo"/></body></html>`;

const LEVER_NAMED = `<html><head><title>Insomnia Cookies</title>
<meta name="twitter:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/abc-1675282727980.png">
<meta property="og:title" content="insomniacookies jobs" />
<meta property="og:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/abc-1675893893657.png" />
</head></html>`;

const LEVER_BARE = `<html><head><title>nitra</title>
<meta name="twitter:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/71cd-small.png">
<meta property="og:title" content="nitra jobs" />
<meta property="og:image" content="https://lever-client-logos.s3.us-west-2.amazonaws.com/71cd-card.png" />
</head></html>`;

const ASHBY = `<html><head><title>Polymarket Jobs</title>
<meta property="og:title" content="Polymarket Jobs" />
<meta property="og:image" content="https://app.ashbyhq.com/api/images/org-theme-logo/ce2d/a875/1e7d.png" />
</head></html>`;

const WORKDAY = `<html><head><title></title>
<meta name="title" property="og:title">
<meta name="image" property="og:image" content="https://msk.wd108.myworkdayjobs.com/mskcc_careers_primary/assets/logo">
</head></html>`;

describe('board identity', () => {
  it('greenhouse: og:title is the real name, og:image the logo', () => {
    expect(greenhouse.parseIdentity(GH, 'sponsorsforeducationalopportunity')).toEqual({
      name: 'SEO (Sponsors for Educational Opportunity)',
      logoUrl: 'https://s2-recruiting.cdn.greenhouse.io/external_greenhouse_job_boards/logos/400/307/500/original/SEO_No_tagline_Red.png?1643913593',
    });
  });

  it('lever: title is the name when set, twitter:image beats the social card', () => {
    expect(lever.parseIdentity(LEVER_NAMED, 'insomniacookies')).toEqual({
      name: 'Insomnia Cookies',
      logoUrl: 'https://lever-client-logos.s3.us-west-2.amazonaws.com/abc-1675282727980.png',
    });
  });

  it('lever: a title that is just the slug is not a name', () => {
    const id = lever.parseIdentity(LEVER_BARE, 'nitra');
    expect(id.name).toBeNull();
    expect(id.logoUrl).toMatch(/71cd-small/);
  });

  it('ashby: strips the trailing " Jobs"', () => {
    expect(ashby.parseIdentity(ASHBY, 'polymarket')).toEqual({ name: 'Polymarket', logoUrl: 'https://app.ashbyhq.com/api/images/org-theme-logo/ce2d/a875/1e7d.png' });
  });

  it('workday: no name from a js-rendered page, logo from og:image or the assets path', () => {
    expect(workday.parseIdentity(WORKDAY, 'msk|wd108|mskcc_careers_primary')).toEqual({ name: null, logoUrl: 'https://msk.wd108.myworkdayjobs.com/mskcc_careers_primary/assets/logo' });
    expect(workday.parseIdentity('<html></html>', 'msk|wd108|mskcc_careers_primary').logoUrl).toBe('https://msk.wd108.myworkdayjobs.com/mskcc_careers_primary/assets/logo');
  });

  it.each([
    ['Jobs at Acme', 'acme', 'Acme'],
    ['Careers at Acme Corp | Lever', 'acmecorp', 'Acme Corp'],
    ['Acme Careers', 'acme', 'Acme'],
    ['Acme &amp; Sons Jobs', 'acmeandsons', 'Acme & Sons'],
    ['Jobs', 'acme', null],
    ['acme', 'acme', null],
    ['Acme', 'acme', 'Acme'],
    ['insomniacookies', 'insomniacookies', null],
    ['', 'acme', null],
  ])('cleanName(%s) -> %s', (raw, slug, want) => {
    expect(cleanName(raw, slug)).toBe(want);
  });

  it('fetchIdentity resolves relative logo urls against the page', async () => {
    const http = Object.assign(async () => ({ status: 200, url: 'https://jobs.ashbyhq.com/acme', headers: new Headers(), text: '<title>Acme Jobs</title><meta property="og:image" content="/logo.png">', json: () => ({}) }), { delayMs: 0 }) as unknown as HttpClient;
    expect(await fetchIdentity(ashby, 'acme', { http })).toEqual({ name: 'Acme', logoUrl: 'https://jobs.ashbyhq.com/logo.png' });
  });
});
