# What the seed analysis found, and what it means for building the real thing

Written 2026-09-05 after two days of poking at the Feashliaa job dump and 48 live boards. Everything here is from `jd-reporter-seed/`; numbers are as of the 2026-09-04 dump snapshot and the 2026-09-05 probe. I'd treat this as the design input for the crawler, classifier and schema, and expect to revise it after the first full crawl.

> **One revision, recorded here rather than edited in.** The "wait 20 hours and re-crawl before believing it"
> rule appears twice below and is no longer how it works: the second look was dropped in migration
> `0003_no_second_look`, because a finding was never published without a human anyway and the delay only made
> the queue stale. Everything a finding must clear before it is called missing still holds.

## The short version: problems we hit, and the fix for each

1. **Most postings have a range.** At the big NYC employers, 44 of 48 boards disclose pay on 95%+ of postings. There is no giant wall of offenders at the top.
   **Fix:** stop looking for a leaderboard of villains. Look for the few companies that skip it everywhere (Dollar Tree, Polymarket) and the many that skip it on a few postings.

2. **"Which city is this job in" is harder than "is there a range".** 15k postings are upstate NY, 6k are remote at companies with an NYC office, 4k list several cities, 540 boards only say "New York".
   **Fix:** the classifier gives three answers (NYC, NY state only, remote-needs-HQ), and anything with several cities goes to a human.

3. **We don't know where companies are based.** The remote question above can't be answered without it.
   **Fix:** collect HQ city and state for every cohort company before publishing anything about remote postings.

4. **Companies write pay in dozens of formats.** `$85 — $97`, `USD$115,000.00`, `21.50 per hour` with no dollar sign, `54,313.06 USD`, `$400,000-600,000`, `$110,000 (OTE $295,000)`, `up to $325K`, `$120+`.
   **Fix:** one classifier that knows every format we found, run against the 48 boards as tests, and a rule that a single stated figure counts as disclosed.

5. **Some ranges are fake or broken.** `$1 — $2`, `$XX to $XX`, `$143,00`, `$190,0000`.
   **Fix:** unfilled templates and `$1 — $2` are findings (the employer's own text says a range was supposed to be there). Typos are not findings; they go to review.

6. **We got it wrong five times on 48 boards.** Every time, the table looked convincing. Single figures read as missing, Lever's plain-text field was empty while the HTML had the range, tips looked like placeholders, `USD$` broke the regex, Stripe looked 8% disclosed.
   **Fix:** nothing is "missing" until three regex families all fail, the vendor's detail call is made, and the employer's page is fetched. Then it waits 20 hours and a human. Record why each false alarm happened so the fifth time becomes a column, not a surprise.

7. **The ATS feed is not always the truth.** Stripe's Greenhouse data has no pay at all; stripe.com shows `$262,900 - $394,300`. Datadog, Oscar and CoreWeave also send people to their own sites.
   **Fix:** if the posting URL is not on the vendor's domain, the employer's page is the evidence. Read its JSON-LD `baseSalary` and text before deciding anything.

8. **Vendor "plain text" fields lie.** Palantir's salary paragraph was in `additional` (HTML) while `additionalPlain` was empty.
   **Fix:** always strip the HTML fields ourselves. Never read a `*Plain` field.

9. **The four easy ATSes are a tech-shaped sample.** Nonprofits and social services live on Paylocity, hospitals on iCIMS. Skip them and the site is a tech leaderboard.
   **Fix:** three access tiers: JSON feeds, then schema.org JSON-LD on the posting page (covers iCIMS, Paylocity, custom sites), then a browser for submissions only. Sector is a required field on every company.

10. **The list is short at the top and endless at the bottom.** 252 boards are half the NYC postings; 1,400 boards have 1-4 each.
    **Fix:** a fixed cohort (5+ NYC postings, any ATS, plus hand-picked big employers) is the denominator for every published rate. Everything else is a ledger with the same evidence pages, excluded from rates.

11. **Slugs are not company names.** `nyuhs` is a hospital in Binghamton, not NYU Langone. `kalshi` has no locations in its API at all.
    **Fix:** verify display name, HQ and sector for every company before its name appears anywhere.

12. **Some "jobs" are not jobs.** "General Application", "Talent Network", volunteers, a Palantir posting titled "Sales".
    **Fix:** evergreen titles are tagged and never become findings.

13. **Some things are compliant but look odd.** Interns paid `$10,000/month`, sales roles with `$110,000 (OTE $295,000)`, contractors, a "preferred NJ / also NY" posting.
    **Fix:** single figures are compliant. Contractor and multi-city postings are covered by the law but always go to review, never auto-publish.

14. **Workday is expensive, the other three are cheap.** Greenhouse, Lever and Ashby return every job in one request. Workday is 20 per page plus one request per posting, and most of its NY volume is upstate retail.
    **Fix:** crawl Workday tenants by hand-picked list only, paginate a "New York" search, cap detail fetches. Greenhouse detail calls only for postings the text classifier didn't clear. Sequential, 1-3 seconds apart, was enough; no rate limits hit.

15. **The dump we started from cannot tell us about compliance.** Its `salary` field is a title lookup table, not posting data.
    **Fix:** use Feashliaa only to decide where to look. Every published number comes from our own fetch.

## 1. What we actually did

- Loaded the Feashliaa dump (1.49M postings, 7 ATSes, 31k boards) into DuckDB with no ATS calls, regex-tiered every location string into `nyc_strict` / `ny_state` / `other`, and defined a seed cohort.
- Tagged every cohort board with a sector (LLM pass via editor subagents, no API spend) plus a title-regex fallback for the long tail.
- Probed 48 boards (top 12 per vendor by NYC volume) with one list call each, paginated Workday, and ran a crude pay-range classifier on ~4,000 NYC postings. Then checked every single flag against the source text, which is how most of the lessons below got learned.

## 2. Core findings

### The universe is smaller and more concentrated than the spec assumed

- 26,999 NYC postings on the four JSON-API vendors, across 2,722 boards. 252 boards hold half of them, 855 hold 80%. A cohort of "5+ NYC postings" is 1,267 boards and 89% of the volume; the other 1,400 boards have 1-4 postings each.
- Greenhouse is half of everything (13.5k). Ashby is 696 boards, not the 3,161 slugs in the list, so the rate-limit worry was overblown. Workday is 1,066 tenants with an average of 297 postings each, and most of its NY volume is upstate retail and hospitals (Lowe's, Dollar Tree, Albany Med, UHS Binghamton), so it is hand-picked tenants only.
- ~2,000 new NYC postings a week in August on those four vendors. That is the daily crawl and review load.

### The ATS choice is a sector choice

The four JSON vendors are where tech, media, finance and ad agencies live. Paylocity's biggest NYC boards are ADAPT Community Network, ACMH, VIP Community Services, the YWCA: that is the nonprofit and social-services sector, almost entirely. iCIMS has 259k postings on 1,739 boards in the dump with zero location data, and its biggest tenants are health systems. Leave those out and the site is a tech leaderboard with a methodology footnote. The sector tags on the cohort make the same point: software + AI is ~31% of cohort NYC postings; healthcare + nonprofit + education + hospitality together are about the same size.

### Jurisdiction is a bigger problem than disclosure

Before reading a single job description, the NY-adjacent volume splits into: 15.4k postings that are NYS-only (Buffalo, Albany, Rochester), 6.4k remote-US postings on boards that also hire in NYC (covered only if HQ is in NYC, which we cannot see), 4.1k multi-city strings with an NY token (23.6% of Greenhouse NYC postings; CoreWeave alone is 190 of 216), and 540 boards whose only NY signal is a bare "New York". The classifier needs three jurisdiction outputs (NYC / NYS-only / remote-pending-HQ), multi-city goes to review, and company HQ is a prerequisite, not a nice-to-have.

### At the top of the cohort, almost everyone discloses

44 of 48 probed boards were 95-100% disclosed. Across ~4,000 NYC postings the residue was:

- **Dollar Tree**: 17 Brooklyn and Staten Island store postings with no pay anywhere in the Workday JSON. The only "none" board, and a retail one.
- **Polymarket**: 15 of 66 NYC postings, only text is "Competitive salary & equity".
- **Nitra**: 5 with nothing, 2 with only a ceiling ("up to $325K").
- Unfilled templates: Braze "between $XX and $XX/year", CoreWeave "$XX to $XX", DoorDash "$XXX"; placeholders: Anthropic "$1 — $2" (twice), Mediabrands "$1 — $1".
- Typos: CoreWeave "$143,00", "$127,0000", "$275,00"; EliseAI "$190,0000".
- One open floor: EliseAI "Base Salary: $120+ / OTE $240k+". A handful of singles: Rogo 2, Profound 1, RFCUNY 1.

So the story at the top is "a few dozen postings, mostly form mistakes, plus two companies where it looks systematic". The interesting rates are further down the list and in the sectors we haven't crawled yet.

### The pay-text format zoo

Every one of these was a real posting and each one broke a version of the regex:

`$124,979.94 — $141,000` · `$85 — $97 USD` (hourly, no commas) · `$400,000-600,000` (second amount without `$`) · `$ 243 , 800 -$ 303 , 000 /year` · `USD$115,000.00 - USD$147,500.00` · `New York, NY Pay Rate: USD $17.25` · `The base pay for this role is: 21.50 per hour` (no dollar sign) · `Annual Salary - 54,313.06 USD` · `$110,000 (OTE $295,000)` (single base, compliant) · `$10,000/month` (interns) · `$17 - $18 / hour ... + $2-3/hour in tips` · `up to $180k + equity` · `$120+` · `$XX to $XX` · `$1 — $2` · Lever structured `salaryRange` and Ashby `compensationTierSummary`.

### The parser was wrong five times before it was right

1. EliseAI sales roles flagged as missing: they state a single base figure. Dash-only regex.
2. Palantir flagged as missing: the range was in Lever's `additional` (HTML) while `additionalPlain` was empty. Never trust a vendor's plain-text field.
3. Dig flagged 167 placeholders: "$2-3/hour in tips" matched before "$17 - $18 / hour". Pick the largest range on the page, then judge magnitude.
4. BlackRock and Gopuff flagged as missing: `USD$` prefix and `USD $17.25` without a period word.
5. Stripe flagged 86 missing: see below.

Each false alarm looked completely convincing in a table. The spec's zero-false-positive audit is the whole product.

### Stripe: the ATS JSON is not always the source of truth

Stripe's Greenhouse feed has no pay data on any of its 86 NYC postings (`content` and `pay_input_ranges` both empty). stripe.com/careers renders "$262,900 - $394,300" and JSON-LD `baseSalary` from Stripe's own CMS. Datadog, Oscar and CoreWeave also send applicants to their own domains. For any posting whose `absolute_url` is off the vendor host, API silence proves nothing; the employer page is the evidence.

### Small things that will bite

- Slugs are not names: the Workday tenant `nyuhs` is United Health Services in Binghamton, not NYU Langone. Sector and HQ enrichment has to happen before anything is published under a company name.
- Location false positives are real: Manhattan KS, Manhattan Beach CA, Brooklyn Park MN, Brooklyn OH, Williamsburg VA, Astoria OR, Queensland.
- Evergreen postings ("General Application", "Talent Network", volunteers, "Sales") are not jobs and should never be findings.
- Contractor postings (CoreWeave's sourcer, Oscar's 1099 physician) are covered by the NYC law but read differently to a human; review, don't auto-publish.
- Kalshi is in the dump as an NYC employer but its Ashby board has no locations at all. Location data in the API can be empty even when the dump had it.
- The dump's `salary` field is a title-based lookup table, not posting data. Nothing about compliance can come from Feashliaa.

## 3. What this means for the scraper

**Cohort first, everything else is ledger.** Define the denominator up front: every employer with 5+ NYC postings at seed time, any ATS, plus a hand-curated list of the largest NYC employers. Commit to covering the cohort by whatever tier it takes. Rates and sector breakdowns are computed on the cohort only. Submissions and long-tail boards get the same evidence pages, flagged out-of-cohort. A submission that reveals a 5+ employer promotes it.

**Three access tiers, one generic fallback.** Tier 1 is an unauthenticated JSON feed (Greenhouse, Lever, Ashby, Workday, BambooHR, SmartRecruiters, Workable, Recruitee). Tier 2 is schema.org JobPosting JSON-LD on the posting page (iCIMS, Paylocity, Taleo, SuccessFactors, and every custom career site Google indexes). Tier 3 is a browser and a screenshot, submissions only. None of it is CSS-selector scraping.

**The evidence surface is the page the applicant sees.** Store both: the ATS JSON as the discovery and diff surface, and the `absolute_url` page (JSON-LD + text) as the compliance surface whenever the two differ. Rule: if the URL host is not the vendor's, fetch the page before classifying. Structured `baseSalary` from JSON-LD is a first-class range source, equal to Greenhouse `pay_input_ranges`.

**Fetch shape.** Greenhouse, Lever and Ashby are one request per board with descriptions included; parse the HTML fields, not the `*Plain` ones. Greenhouse `pay_input_ranges` needs a per-posting detail call, so make it only for NYC postings the text classifier did not clear. Workday is 20 per page with a detail call per posting; paginate a "New York" search, filter with the location regex, cap details per tenant, and only crawl hand-picked tenants. Sequential with 1-3 s spacing produced zero 429s across ~600 requests including Ashby, so the per-vendor concurrency in the spec is generous; start lower and let it be boring. Cache every raw response gzipped with a hash; it made every re-analysis free.

**Never call anything missing on the first pass.** "None" requires: no structured field, no two-amount range, no single figure in any of the formats above, no `$X+`, not an evergreen title, then the vendor detail call, then the employer page if off-site. Only then does it become `detected`, and it still needs the second crawl 20 hours later and a human before it is `published`.

## 4. What this means for the classifier

Ordered decision, each step recording an evidence span and the classifier version:

1. Structured field present (`pay_input_ranges`, `salaryRange`, `compensationTiers`, JSON-LD `baseSalary`) → `structured`.
2. Title matches evergreen → `evergreen`, never a finding.
3. Text contains `$XX` / `$YY` style → `placeholder_range` (unfilled template; strong finding, review first).
4. Malformed digit groups (`$143,00`, `$190,0000`) → `malformed_range` (review only, not a finding: they tried).
5. All two-amount ranges found; take the one with the largest maximum. If max < $10 → `placeholder_range` (`$1 — $2`). Else → `text_range`. Money tokens must accept `USD` prefixes and suffixes, missing `$` on the second amount, spaces inside numbers, k-suffixes, hourly amounts without commas.
6. One bound only (`$120+`, `up to $325K`) → `open_ended` (finding).
7. Single figure in any format (`$110,000`, `$10,000/month`, `USD $17.25`, `21.50 per hour`, `54,313.06 USD`) → `fixed_rate` (compliant).
8. Otherwise → `none`, subject to the confirmation gates above.

Funding-round money (`$250 million Series E`, `$21B traded`) must be excluded from step 7. Tips and bonuses (`$2-3/hour in tips`, `$15K bonus!`) must not win step 5.

Jurisdiction: `nyc = covered` only for an unambiguous city string (boroughs with NY context, "New York, NY", "NYC", "New York City"); bare "New York" and "New York, United States" are `covered` with lower confidence; any multi-city string with a non-NY city is `possible` and goes to review; remote-US is `possible` until HQ is known; "X, New York, United States" is `nys_only`. Keep the exclusion list for the other Manhattans and Brooklyns.

Save the 48 probed boards as classifier fixtures. Every branch above has a real example in `data/raw/`.

## 5. What this means for the data model

Additions to the spec's Drizzle schema, all of which the seed already produces:

**companies**
- `sector`, `sector_source` (`manual` | `agent` | `titles` | `none`), `sector_confidence`, `naics2`. Taxonomy in `sectors.csv`; manual overrides win.
- `hq_city`, `hq_state`, `hq_source`. Required for the remote inference; not yet populated.
- `access_tier` (1 json feed, 2 json-ld, 3 browser) and `careers_host` (the host postings redirect to; if it is not the vendor's, the employer page is the evidence surface).
- `in_cohort`, `cohort_reason` (`threshold: 5+ nyc postings` | `manual: ...`).
- `display_name` separate from `ats_slug`, verified before publishing (nyuhs).

**postings**
- `locations` as an array plus derived `loc_class` (`nyc_strict` | `ny_bare` | `ny_state` | `other`), `multi_city`, `remote_us`.
- `canonical_url` and `is_offsite` (host differs from vendor).
- `is_evergreen`, `employment_type` incl. contractor / intern, since these drive review.

**snapshots**
- `range.method` enum extended: `structured`, `text_range`, `fixed_rate`, `open_ended`, `placeholder_range`, `malformed_range`, `dollar_mention_only`, `evergreen`, `offsite_unverified`, `none`.
- `range.evidence_span` and `range.source` (`ats_api` | `employer_page_jsonld` | `employer_page_text` | `detail_call`).
- `jurisdiction` three-state per jurisdiction with `reasons[]` and a `confidence`.
- Two raw keys where they differ: `raw_key` (ATS JSON) and `page_key` (employer page).

**findings**
- `type` adds `placeholder_range` and `one_sided_range`; `malformed_range` is review-only and never a finding.
- A company-level rollup (postings checked, disclosed, by method) so the leaderboard can show "disclosed 98% of 99" next to any finding, which is the honest framing for EliseAI-shaped companies.

**reviews**
- Add a `false_positive_reason` enum seeded from what already happened: `parser_missed_format`, `plain_field_empty`, `offsite_page_had_range`, `tips_or_bonus_not_pay`, `evergreen`, `location_false_positive`, `multi_city_preferred_elsewhere`. If we have to learn a category five times, it should at least be a column.

## 6. What we have not verified

- Dollar Tree's public Workday pages were not opened in a browser; the JSON that renders them has no pay text, which is strong but not the same as looking.
- iCIMS volume and locations are unknown until fetched; the six manual cohort tenants are guesses from slugs.
- Paylocity and BambooHR boards were not probed.
- Sector tags are one LLM pass plus a title regex; the 52 agent-vs-regex disagreements are listed in the notebook and nobody has adjudicated them.
- No HQ data exists yet, so the 6.4k remote-US postings are unclassified.
- Everything above is ~4,000 postings from the 48 most-scrutinized employers on the friendliest ATSes. The rates will look different in the long tail.
