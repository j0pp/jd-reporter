# JD Reporter — MVP Spec (v0.1, 2026-09-05)

Decisions locked in this doc: TypeScript end to end, free tiers only, JSON-API ATSes only for v1, scope = every NYC-performable posting we can reach on those ATSes, any industry.

## 1. What the MVP is

A seeded, continuously re-crawled ledger of NYC job postings from employer-owned job boards, with a public site that shows per-company compliance with the NYC/NYS pay-range laws, and a submit form that lets anyone paste a posting URL and have it verified and archived by a background job. Unclear cases go to a review queue you work through in a simple admin page.

Not in the MVP: notices/emails to employers, employer claim and dispute flow, complaint-packet generator, wide-range flags, HTML-only enterprise ATSes, any jurisdiction other than NYC/NYS. The schema leaves room for all of these; the code doesn't build them.

Definition of done: the site is live, shows at least 500 NYC employers and their postings with correct compliance status, a pasted URL from any of the four supported ATSes gets a verified answer within a few minutes, and a hand audit of 100 published findings has zero false positives.

## 2. Architecture (all free tier)

```
GitHub Actions (public repo, unlimited minutes)
  ├─ discover.yml   weekly   : build/refresh company list → Postgres
  ├─ crawl.yml      daily    : fetch every board, classify, diff, write snapshots → Postgres + R2
  └─ process.yml    on demand: repository_dispatch from the site; parses one submitted URL,
                               screenshots, Wayback-archives, writes finding → Postgres + R2
Neon Postgres (free)                Cloudflare R2 (free, no egress)
  companies, postings, snapshots,     raw JSON, HTML, screenshots, weekly pg_dump
  findings, submissions, reviews
Next.js on Vercel Hobby (free)
  /                   stats + leaderboard
  /c/[slug]           company page
  /p/[id]             posting evidence page
  /submit             paste a URL (Turnstile-protected) → quick sync check → queue
  /admin              review queue (basic auth), approve/reject/flag
  /methodology, /law, /about, /dispute
```

Why this shape: GitHub Actions is the only free place to run Playwright for screenshots and long crawls without a timeout; making the repo public gets unlimited minutes and buys credibility (the methodology is inspectable). Vercel functions stay under 10 s and only do the cheap synchronous check on submit. R2 has no egress fees, which matters once a journalist links a screenshot. Neon's 0.5 GB is enough because heavy blobs live in R2 and the DB only holds metadata and hashes.

Swap-ins if you prefer: Cloudflare Pages + Workers + D1 instead of Vercel + Neon (one vendor, but D1's 100k row-writes/day is tight for a daily crawl); Turso instead of Neon (more generous write limits, SQLite semantics).

## 3. Discovery: building the list of NYC job boards

Two directions, run both, union the results. Everything keyed on `company.domain`.

**ATS-side (find every board, then filter to NYC by posting location).**
- Existing slug lists: `Feashliaa/job-board-aggregator` ships `data/{greenhouse,lever,ashby,workday}_companies.json` (CC BY-NC).
- Common Crawl CDX for each host pattern, latest 3 monthly indexes: `boards.greenhouse.io/*`, `job-boards.greenhouse.io/*`, `jobs.lever.co/*`, `jobs.ashbyhq.com/*`, `*.myworkdayjobs.com/*`, `jobs.smartrecruiters.com/*`, `apply.workable.com/*`. Regex the slug (or the Workday tenant + site). Run in the discover Action; results are patchy for small companies, that's expected.
- Filter: fetch each board, keep companies with ≥1 posting whose location matches NYC (borough names, "New York", "NY" state code) or is remote-US with the company HQ in NY.

**Company-side (start from NYC employers, detect the ATS).** This is what finds the Eisens.
- SEC EDGAR company search by business-address state NY (free, public companies; filter city to NYC boroughs).
- Built In NYC company directory; Wellfound NYC filter; NYC-based VC portfolio pages (Index, First Round, Lerer Hippeau, USV, Thrive, Insight, General Catalyst NYC, a16z NYC list).
- Crain's largest NYC employers lists, NYC hospital systems, universities, media companies, banks (a hand-curated ~300-row CSV for the big names is a few hours' work and worth it).
- For each company: fetch homepage, follow the careers link (anchor text /careers|jobs|join/i), match against ATS patterns: `boards.greenhouse.io/{slug}`, `job-boards.greenhouse.io/{slug}`, `jobs.lever.co/{slug}`, `jobs.ashbyhq.com/{slug}`, `{tenant}.wd{n}.myworkdayjobs.com/{site}`, plus embed signatures in the page source (`boards.greenhouse.io/embed/job_board?for={slug}`, `__ashbyBaseJobBoardUrl`, `lever.co/v0/postings/{slug}`). Store `ats_vendor`, `ats_slug`, `careers_url`, `discovered_via`.
- Unknown ATS → store the careers URL with `ats_vendor='unknown'`; the submit flow's schema.org fallback can still handle individual postings from those sites.

**Employee-count estimate** (for the 4-employee threshold): number of open postings (≥5 → clearly covered), public-company status, funding stage from the VC list. Store `employee_estimate` and `employee_estimate_source`; leave null when unknown, which is itself a review trigger.

## 4. Parsers (one module per ATS, one interface)

```ts
interface BoardParser {
  vendor: 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'schemaorg';
  matches(url: URL): { slug: string } | null;          // for submitted URLs
  fetchBoard(slug: string): Promise<RawPosting[]>;      // list + enough detail to classify
  fetchPosting(slug: string, id: string): Promise<RawPosting>;
}
interface RawPosting {
  externalId: string; url: string; title: string;
  locations: string[]; isRemote: boolean | null;
  descriptionText: string; descriptionHtml: string;
  structuredComp: { min: number; max: number; currency: string; period: string }[] | null;
  publishedAt?: string; updatedAt?: string; raw: unknown;
}
```

| Vendor | List | Detail needed? | Structured comp |
|---|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | Yes, `…/jobs/{id}?pay_transparency=true` for `pay_input_ranges` (only when list has no range in `content`) | `pay_input_ranges[]` cents |
| Lever | `GET api.lever.co/v0/postings/{slug}?mode=json` | No | `salaryRange` (rarely set) |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | No | `compensation.compensationTiers[]` |
| Workday | `POST {tenant}.wd{n}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` (paginate 20) | Yes, `GET …/job/{slug}` for description | none; regex only |
| schema.org fallback | fetch the submitted page, parse `<script type="application/ld+json">` JobPosting | — | `baseSalary` |

Greenhouse detail calls are the expensive part (one per NYC posting). Cache by `updated_at`; only re-fetch when it changes.

The Greenhouse parser makes one further GET per posting whose API record carries no structured pay and whose `absolute_url` is on the employer's own domain rather than a Greenhouse host: it reads that employer-hosted page and folds its text (and any schema.org `baseSalary`) into the description before the classifier runs. Some employers state the range only on their own page (Stripe is a live example), and reading the API alone would publish "no salary range found" about a posting that visibly states one. It costs at most one extra request per already-rangeless Greenhouse posting, and never fires when the API supplied a range or when the board is Greenhouse-hosted.

## 5. Classifier

Runs per posting, pure function, deterministic, returns a record that is stored verbatim on the snapshot so every published statement can be traced to the exact input.

```ts
type Jurisdiction = { nyc: 'covered'|'possible'|'no'; nys: 'covered'|'possible'|'no'; reasons: string[] };
type RangeResult = {
  method: 'structured'|'text_range'|'fixed_rate'|'commission'|'open_ended'|'dollar_mention_only'|'none';
  min?: number; max?: number; currency?: string; period?: 'year'|'hour'|'other';
  evidenceSpan?: string;      // the exact text or JSON path the decision came from
  confidence: number;         // 1.0 structured, 0.9 clean regex, 0.5 dollar mention, etc.
};
```

Jurisdiction rules (NYC): any location string matching borough/NYC/New York → `covered`; `isRemote` or remote-US wording with company HQ in NYC → `covered`; remote-US with HQ elsewhere → `possible`; description contains "not available to New York" / "cannot be performed in New York" → `possible` with reason; else `no`. NYS mirrors this with the "reports to a NY supervisor" nuance ignored for v1 (we can't observe it).

Range rules: structured fields first; then regex over description text for two money amounts joined by a dash/to/and (with k-suffix support); a single amount with "per year/hour" → `fixed_rate` (compliant); "commission" → `commission` (compliant under NYS); "$X+" → `open_ended` (non-compliant); a lone dollar figure → `dollar_mention_only` (review); nothing → `none`.

No LLM in the MVP classifier. It's cheaper, deterministic, and explainable in a dispute; add an LLM pass later only for the `dollar_mention_only` bucket if it turns out to be big.

## 6. Finding lifecycle and the review rule

A finding is created when a `covered` posting has range method `none` or `open_ended`. It is not public until `status = published`.

```
detected ──(same result on next crawl ≥ 20h later)──► confirmed
confirmed ──(auto-publish rule passes)──► published
confirmed ──(any review trigger)──► needs_review ──(you approve)──► published
                                                   └──(you reject)──► rejected (kept, with reason)
published ──(crawl sees a range on same posting, or posting gone and replacement has range)──► fixed
published ──(posting gone, no replacement)──► stale
```

Auto-publish only when all of these hold: source is the employer's own ATS endpoint (never the schema.org fallback), jurisdiction `covered` on a location string (not the remote inference), range method `none` with both structured and regex empty, the company already has at least one human-approved published finding, and `employee_estimate ≥ 10` or open postings ≥ 5.

Review triggers (any one puts it in the queue): first finding for a company; jurisdiction `possible`; range method `dollar_mention_only` or `open_ended`; employee estimate null or < 10; company name matches /staffing|recruit|talent|temp/i; posting lists multiple cities including a non-NY one; submission came from an aggregator URL; description contains "New York" near "not"/"except"/"excluding"; the same company had a finding rejected before.

Review UI: one page, keyboard-driven, shows the screenshot, evidence span, jurisdiction reasons, company info, and three buttons (publish / reject with reason / snooze). Aim for 10 seconds per item; you'll have a few hundred at seed time and a trickle after.

## 7. Submission flow

1. `/submit`: URL field, optional note, optional email, Cloudflare Turnstile. Rate limit 10/hour/IP (Upstash Redis free tier or Vercel KV).
2. Sync (in the Vercel function, < 5 s): canonicalize URL; classify as ATS/aggregator/unknown; if ATS and a known company, fetch the single posting JSON and run the classifier; write `submission` + `posting` + `snapshot(raw only)` rows; return a status page with the preliminary result ("range found: $X–$Y" / "no range detected, queued for verification"). Aggregator URLs (LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google, Wellfound, Built In): try to extract the outbound apply link from the page's JSON-LD or `applyUrl`; if that resolves to a supported ATS, continue; otherwise store as `unresolved_aggregator` and tell the user what to paste instead.
3. Async: the function calls the GitHub API `repository_dispatch` with the submission id. `process.yml` starts within ~30 s, re-fetches, screenshots with Playwright, requests a Wayback Save Page Now capture (authenticated; `if_not_archived_within=1d`), stores the evidence in R2, creates/updates the finding, and, if the company is new, enqueues a full board crawl for it.
4. Status page polls the submission row; the user sees "verified, under review" or "published" with the link.

Never trust a user screenshot as evidence. Never publish anything the server didn't fetch itself.

## 8. Data model (Drizzle, Postgres)

See `packages/core/src/db/schema.ts`. Tables: `companies`, `postings`, `snapshots`, `findings`, `submissions`, `reviews`, `crawl_runs`, `jurisdictions`. `crawl_runs` carries `postings_skipped` and `posting_errors` alongside the other counters, so a run that recorded nothing cannot read as a healthy one; `companies.last_ats_detect_at` stamps each careers-detect attempt so the weekly sweep can order by least-recently-attempted instead of an offset that drifts as rows are added. Key choices: `companies.domain` is the natural key; `postings` are unique on `(company_id, ats_vendor, external_id)`; `snapshots` are append-only and store `raw_sha256`, R2 keys, `range_result` and `jurisdiction_result` as JSONB; `findings` reference `first_snapshot_id` and `latest_snapshot_id`; every status change writes a `reviews` row (actor, from, to, reason) so the history is auditable.

## 9. Rate limiting and politeness

- Identify yourself: `User-Agent: jd-reporter/0.1 (+https://yoursite/methodology; contact@yoursite)`.
- Per-vendor concurrency in the crawler: Ashby 3, Greenhouse 8, Lever 5, Workday 2 per tenant. Exponential backoff on 429/5xx, give up after 4 tries, log the company as `crawl_error` and retry next day. Ashby is the strictest; expect 429s above ~4 concurrent.
- Cadence: companies with open findings daily; everyone else every 3 days; new submissions immediately. Greenhouse detail calls only when `updated_at` changed. This keeps a 3,000-company crawl around 20–40 minutes and well under any free-tier limit.
- Respect robots.txt on career pages you fetch for discovery. The ATS JSON endpoints are documented public APIs on separate hosts and are what the employer's own page calls; that's the crawl surface, not the HTML.
- Wayback SPN: archive findings only, not every posting; authenticated keys; a few per minute is fine. Store the returned `web.archive.org/web/{ts}/{url}` on the snapshot.
- Submissions: Turnstile + 10/hour/IP + dedupe by canonical URL within 24 h.

## 10. Cost ceiling (as of Sept 2026, verify before relying on)

| Service | Free tier | What you'll use |
|---|---|---|
| GitHub Actions | unlimited minutes on public repos (2,000/mo private); 6 h/job | ~1 h/day crawl + ad-hoc processing |
| Neon Postgres | 0.5 GB, autosuspends, 190 compute-hours/mo | ~100 MB for 100k postings if blobs are in R2 |
| Cloudflare R2 | 10 GB, 1M writes/mo, 10M reads/mo, no egress | screenshots ~150 KB each → archive findings only, ~20k before you care |
| Vercel Hobby | 100 GB bandwidth, 1M function invocations, non-commercial only | site + submit endpoint |
| Cloudflare Turnstile | free | submit form |
| Upstash Redis | 500k commands/mo | rate limiting |
| Wayback SPN | free with account | archiving findings |
| Domain | ~$10–15/yr | the only real cost |

Keep it here by: storing raw JSON gzipped, screenshotting only findings, no LLM calls in the hot path, and pruning `snapshots` blobs for `no`-jurisdiction postings after 30 days (keep the row and hash).

## 11. Other considerations

- **Public repo, public data.** Publish the methodology and the dataset (CSV export, CC BY). Transparency is the defense against "your bot got it wrong" and the thing journalists need to trust the numbers.
- **Canonical identity.** Companies by domain; postings by ATS id, not URL (URLs change). A reposted job with a new id is a new posting; link them by title+location for "fixed via replacement."
- **Dispute channel before launch.** A `/dispute` page and an email address, with a 2-business-day promise to review, even before the employer claim flow exists. Log everything in `reviews`.
- **Legal copy** on posting pages: "As of {timestamp} this posting, archived {link}, contained no salary range. NYC Admin. Code § 8-107(32) and NY Labor Law § 194-b require a good-faith minimum and maximum for positions performed in NYC. Employers can dispute this here." No "violation" or "illegal" anywhere in UI text.
- **Secrets** in Actions secrets and Vercel env: Neon URL, R2 keys, Wayback keys, GitHub token for dispatch, admin basic-auth password, and `HASH_SALT` (the salt for submitter IP/email hashes — unset in production is a hard failure, because the committed development salt makes those hashes reversible by enumeration).
- **Backups:** weekly `pg_dump | gzip` → R2 from an Action. Neon free has short history retention.
- **Monitoring:** Actions failure emails are enough; add a `crawl_runs` row per run with counts so the stats page can show "last crawled N hours ago."
- **Vercel Hobby non-commercial clause:** you're fine as long as there's no revenue; if you later take donations, move to Cloudflare Pages.
- **Naming/domain:** pick something that reads as a campaign employers can join, not a blacklist.

## 12. Build order (each step is shippable)

1. Repo scaffold: pnpm monorepo, `packages/core` (parsers, classifier, schema), `apps/web` (Next.js), `.github/workflows`. Drizzle migrations against Neon.
2. Parsers + classifier with fixtures: save a dozen real board responses (Eisen's included) as test fixtures; unit tests for every classifier branch.
3. Discovery Action: slug lists + Common Crawl + a hand-curated NYC big-employer CSV → `companies`.
4. Crawl Action: full pipeline into Postgres + R2, findings created, nothing published. Run it, look at the numbers.
5. Admin review page. Work the queue for the first ~200 companies by hand. This is where you learn what the classifier gets wrong; fix it before anything is public.
6. Public site: stats, company pages, posting pages, methodology, law, dispute.
7. Submit form + process Action + status page.
8. Launch checklist: 100-finding hand audit at zero false positives, dispute email live, dataset export, one recognizable name in the first batch.
