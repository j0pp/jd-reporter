import type { Metadata } from 'next';
import { getSite } from '@/lib/data';
import { fmtDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Methodology: how JD Reporter reads job postings' };

export default function Methodology() {
  const site = getSite();
  return (
    <article className="prose-block max-w-3xl py-12 text-lg leading-relaxed">
      <h1 className="text-5xl font-black leading-[0.95] tracking-tight md:text-6xl">How this works</h1>
      <p className="mt-6 text-ink-soft">
        I built this because the honest version of the question &ldquo;who is skipping pay ranges&rdquo; turned out to be harder than it sounds, and every shortcut I
        tried gave a wrong answer that looked right in a table. So the method is mostly a list of ways to not be wrong.
      </p>

      <h2>We read the employer&apos;s own board, not an aggregator</h2>
      <p>
        When the New York City Council studied compliance in 2023 they looked at Indeed and Google for Jobs and found that many missing ranges were an artifact of
        how those sites scrape postings, not of what the employer wrote. So we never read aggregators. Every posting here comes from the employer&apos;s own
        applicant tracking system (Greenhouse, Lever, Ashby or Workday), through the same public endpoint the employer&apos;s careers page calls. If a posting
        links out to the employer&apos;s own website instead, we read that page too, because for some employers (Stripe is the well-known case) the board feed
        carries no pay data while the page does. Silence in a feed is never evidence on its own.
      </p>

      <h2>Only New York, and we say which New York</h2>
      <p>
        We keep a posting only if its location reads as New York. &ldquo;New York, NY&rdquo;, a borough, or &ldquo;NYC&rdquo; is the city, and both laws apply. Buffalo
        or Albany is the state law only. A bare &ldquo;New York&rdquo; with no other city is treated as the city, at lower confidence. Postings that list several cities
        including New York are covered but always go to a person. Remote postings are not assessed at all until we know where the company is headquartered, because
        the law turns on that and we cannot see it.
      </p>

      <h2>A single stated figure counts as disclosed</h2>
      <p>
        The law asks for a minimum and a maximum, but an employer who writes &ldquo;$110,000&rdquo; has told you what the job pays. We count that as disclosed. What
        we count as a finding is: no pay figure anywhere; one bound only (&ldquo;up to $180k&rdquo;, &ldquo;$120+&rdquo;); or an unfilled template (&ldquo;$XX to
        $XX&rdquo;, &ldquo;$1 to $2&rdquo;), because the employer&apos;s own text says a range was meant to be there. Typos like &ldquo;$143,00&rdquo; are not findings;
        they tried. Funding rounds, bonuses, stipends and tips are not pay, and the reader knows the difference.
      </p>

      <h2>Nothing is published on the first read</h2>
      <p>
        A posting that reads as non-disclosed is re-read at least 20 hours later. If it still reads the same, it goes into a review queue where a person looks at
        the actual text, the employer&apos;s structured pay fields, the location string and the company name before it is published. Every one of those decisions
        is logged. If the person says no, the reason is recorded in a fixed list (the parser missed a format, the range lived on the employer&apos;s page, the money
        was tips, the location was Manhattan, Kansas) so the same mistake becomes a test rather than a repeat.
      </p>

      <h2>Findings disappear on their own</h2>
      <p>
        We crawl every board every day. When a range appears on a posting we published, the finding is marked fixed and drops off the next morning. When the
        posting is taken down, it is marked stale and drops off too. What you see is the current state, not a history.
      </p>

      <h2>Four employees, inferred from five postings</h2>
      <p>
        Both laws apply to employers with four or more employees. We cannot count employees from the outside, so we use a proxy we can see: five or more open
        postings on the board, any location. Companies below that are listed but not scored, and say so on their page. Staffing firms are exempt under both laws and
        are excluded entirely.
      </p>

      <h2>What a leaderboard rank means</h2>
      <p>
        The leaderboard ranks by the number of current published findings, with a floor of two so a single template mistake cannot top it on a quiet day. The
        count always sits next to the company&apos;s total New York postings and its disclosure rate, because 3 of 300 and 15 of 66 are different stories.
      </p>

      <h2>Everything is checkable</h2>
      <p>
        Each published finding has an evidence page with the exact text we decided on, the raw record we read, a link to the live posting and (where available) a
        Wayback Machine capture. The dataset is downloadable and licensed CC BY. The code that does all of this will be public with the repository.
      </p>

      <h2>Where the list of companies comes from</h2>
      <p>
        The starting list was built from the open Feashliaa job-board dataset (CC BY-NC 4.0), used only to decide which boards to read, never as evidence. New
        boards arrive weekly from the same source and from public submissions. Anyone can add a board or a posting from the submit page.
      </p>

      <p className="mt-10 text-sm text-ink-soft">
        Data last generated {fmtDateTime(site.generatedAt)}. Last crawl {fmtDateTime(site.lastCrawlAt)}.
      </p>
    </article>
  );
}
