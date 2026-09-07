import { describe, expect, it } from 'vitest';
import { ashby } from '../src/ats/ashby.ts';
import { greenhouse } from '../src/ats/greenhouse.ts';
import { lever } from '../src/ats/lever.ts';
import { isOffsite, matchAnyAdapter } from '../src/ats/registry.ts';
import { classifySubmittedUrl, detectEmbeddedBoard } from '../src/ats/url.ts';
import { workday } from '../src/ats/workday.ts';
import { classifyPosting } from '../src/posting.ts';

describe('url matching', () => {
  it.each([
    ['https://boards.greenhouse.io/anthropic/jobs/4012345', 'greenhouse', 'anthropic', '4012345'],
    ['https://job-boards.greenhouse.io/Stripe/jobs/6789?gh_src=abc', 'greenhouse', 'stripe', '6789'],
    ['https://boards.greenhouse.io/embed/job_app?for=braze&token=555', 'greenhouse', 'braze', '555'],
    ['https://jobs.lever.co/palantir/0f8e6c6e-1234-4b1c-9c0d-abcdef123456', 'lever', 'palantir', '0f8e6c6e-1234-4b1c-9c0d-abcdef123456'],
    ['https://jobs.ashbyhq.com/ramp/1c2d3e4f-1234-4b1c-9c0d-abcdef123456', 'ashby', 'ramp', '1c2d3e4f-1234-4b1c-9c0d-abcdef123456'],
    ['https://msk.wd108.myworkdayjobs.com/en-US/mskcc_careers_primary/job/New-York/Nurse_R123', 'workday', 'msk|wd108|mskcc_careers_primary', 'R123'],
    ['https://dollartree.wd1.myworkdayjobs.com/DollarTree/job/Brooklyn-NY/Sales-Associate_R-1234-5', 'workday', 'dollartree|wd1|DollarTree', 'R-1234-5'],
  ])('%s -> %s %s %s', (url, vendor, slug, externalId) => {
    const m = matchAnyAdapter(new URL(url));
    expect(m?.vendor).toBe(vendor);
    expect(m?.slug).toBe(slug);
    expect(m?.externalId).toBe(externalId);
  });

  it('board urls have no external id', () => {
    expect(matchAnyAdapter(new URL('https://jobs.ashbyhq.com/ramp'))).toEqual({ vendor: 'ashby', slug: 'ramp' });
    expect(matchAnyAdapter(new URL('https://boards.greenhouse.io/anthropic'))).toEqual({ vendor: 'greenhouse', slug: 'anthropic' });
    expect(matchAnyAdapter(new URL('https://jobs.lever.co/spear/'))).toEqual({ vendor: 'lever', slug: 'spear' });
  });

  it('classifies submitted urls and rejects aggregators with the host', () => {
    expect(classifySubmittedUrl('https://www.linkedin.com/jobs/view/123')?.kind).toBe('aggregator');
    expect(classifySubmittedUrl('indeed.com/viewjob?jk=abc')?.kind).toBe('aggregator');
    expect(classifySubmittedUrl('https://boards.greenhouse.io/anthropic/jobs/1?utm_source=x')).toMatchObject({
      kind: 'ats_posting',
      vendor: 'greenhouse',
      canonical: 'https://boards.greenhouse.io/anthropic/jobs/1',
    });
    expect(classifySubmittedUrl('https://jobs.ashbyhq.com/ramp')?.kind).toBe('ats_board');
    expect(classifySubmittedUrl('https://stripe.com/jobs/listing/engineer/123')?.kind).toBe('careers_page');
    expect(classifySubmittedUrl('https://example.com/about')?.kind).toBe('unknown');
    expect(classifySubmittedUrl('not a url at all ://')).toBeNull();
  });

  it('offsite means the posting url is not on the vendor host', () => {
    expect(isOffsite('greenhouse', 'https://stripe.com/jobs/listing/x/123')).toBe(true);
    expect(isOffsite('greenhouse', 'https://boards.greenhouse.io/stripe/jobs/123')).toBe(false);
    expect(isOffsite('lever', 'https://jobs.lever.co/palantir/abc')).toBe(false);
    expect(isOffsite('workday', 'https://msk.wd108.myworkdayjobs.com/x')).toBe(false);
  });

  it('finds ats embeds in a careers page', () => {
    expect(detectEmbeddedBoard('<script src="https://boards.greenhouse.io/embed/job_board/js?for=eisen"></script>')).toEqual({ vendor: 'greenhouse', slug: 'eisen' });
    expect(detectEmbeddedBoard('window.__ashbyBaseJobBoardUrl = "https://jobs.ashbyhq.com/Ramp";')).toEqual({ vendor: 'ashby', slug: 'ramp' });
    expect(detectEmbeddedBoard('fetch("https://api.lever.co/v0/postings/spear?mode=json")')).toEqual({ vendor: 'lever', slug: 'spear' });
    expect(detectEmbeddedBoard('<a href="https://msk.wd108.myworkdayjobs.com/en-US/mskcc_careers_primary">Jobs</a>')).toEqual({
      vendor: 'workday',
      slug: 'msk|wd108|mskcc_careers_primary',
    });
    expect(detectEmbeddedBoard('<p>no ats here</p>')).toBeNull();
  });
});

describe('adapters normalize vendor json', () => {
  it('greenhouse: double-escaped html, offices as locations, pay_input_ranges in cents', () => {
    const [p] = greenhouse.normalizeBoard({
      jobs: [
        {
          id: 1,
          title: 'Engineer',
          absolute_url: 'https://boards.greenhouse.io/acme/jobs/1',
          location: { name: 'New York, NY' },
          offices: [{ name: 'New York' }, { name: 'Remote' }],
          content: '&lt;p&gt;Base salary &amp;amp; equity: $120,000 - $150,000&lt;/p&gt;',
          pay_input_ranges: [{ min_cents: 12000000, max_cents: 15000000, currency_type: 'USD', title: 'NYC' }],
          updated_at: '2026-09-01T00:00:00Z',
        },
      ],
    });
    expect(p!.locations).toEqual(['New York, NY', 'New York', 'Remote']);
    expect(p!.descriptionText).toBe('Base salary & equity: $120,000 - $150,000');
    expect(p!.structuredComp).toEqual([{ min: 120000, max: 150000, currency: 'USD', interval: null, summary: 'NYC' }]);
    const c = classifyPosting('greenhouse', p!);
    expect(c.range.method).toBe('structured');
    expect(c.coverage.coverage).toBe('covered');
  });

  it('lever (palantir): the salary paragraph in `additional` html is read even when additionalPlain is empty', () => {
    const [p] = lever.normalizeBoard([
      {
        id: 'abc',
        text: 'Web Design Engineer',
        hostedUrl: 'https://jobs.lever.co/palantir/abc',
        categories: { location: 'New York, NY', allLocations: ['New York, NY'], commitment: 'Full-time' },
        description: '<p>Build things.</p>',
        descriptionPlain: 'Build things.',
        additional: '<p>Salary: The estimated salary range for this position is estimated to be $135,000 - $200,000/year.</p>',
        additionalPlain: '',
        lists: [{ text: 'What we value', content: '<li>Craft</li>' }],
        workplaceType: 'hybrid',
        createdAt: 1756684800000,
      },
    ]);
    expect(p!.descriptionText).toMatch(/\$135,000 - \$200,000/);
    expect(p!.isRemote).toBe(false);
    expect(p!.publishedAt).toBe('2025-09-01T00:00:00.000Z');
    expect(classifyPosting('lever', p!).range.method).toBe('text_range');
  });

  it('ashby: compensation tiers become structured comp, equity components are dropped', () => {
    const [p] = ashby.normalizeBoard({
      jobs: [
        {
          id: 'x',
          title: 'Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/acme/x',
          location: 'New York',
          secondaryLocations: [{ location: 'San Francisco' }],
          isRemote: false,
          descriptionHtml: '<p>Hi</p>',
          descriptionPlain: 'Hi',
          employmentType: 'FullTime',
          compensation: {
            compensationTierSummary: '$150K – $190K • Offers Equity',
            compensationTiers: [
              {
                components: [
                  { compensationType: 'Salary', interval: '1 YEAR', currencyCode: 'USD', minValue: 150000, maxValue: 190000, summary: '$150K – $190K' },
                  { compensationType: 'EquityPercentage', interval: 'NONE', minValue: 0.01, maxValue: 0.1 },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(p!.structuredComp).toEqual([{ min: 150000, max: 190000, currency: 'USD', interval: '1 YEAR', summary: '$150K – $190K' }]);
    expect(p!.locations).toEqual(['New York', 'San Francisco']);
    const c = classifyPosting('ashby', p!);
    expect(c.range.method).toBe('structured');
    expect(c.coverage.multiCity).toBe(true);
  });

  it('workday: list rows need a detail call and carry the req id', () => {
    const [p] = workday.normalizeBoard({
      total: 1,
      jobPostings: [{ title: 'Nurse', externalPath: '/job/New-York-NY/Nurse_R123', locationsText: '5 Locations', bulletFields: ['R123'], timeType: 'Full time' }],
    });
    expect(p!.externalId).toBe('R123');
    expect(p!.needsDetail).toBe(true);
    expect(p!.descriptionText).toBe('');
    expect(workday.needsDetail(p!, { method: 'none', source: 'ats_api', confidence: 1 })).toBe(true);
  });

  it('greenhouse only pays for a detail call when the text did not settle it', () => {
    const p = greenhouse.normalizeBoard({ jobs: [{ id: 1, title: 'x', absolute_url: 'https://boards.greenhouse.io/a/jobs/1', location: { name: 'NYC' }, content: '' }] })[0]!;
    expect(greenhouse.needsDetail(p, { method: 'none', source: 'ats_api', confidence: 1 })).toBe(true);
    expect(greenhouse.needsDetail(p, { method: 'text_range', source: 'ats_api', confidence: 1 })).toBe(false);
    expect(greenhouse.needsDetail(p, { method: 'offsite_unverified', source: 'ats_api', confidence: 1 })).toBe(true);
  });
});
