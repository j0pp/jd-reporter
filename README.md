# JD Reporter

A public ledger of New York job postings that did not include a pay range. It reads each employer's own job board (Greenhouse, Lever, Ashby, Workday) every day, classifies every New York posting, re-reads anything that looks non-disclosed 20 hours later, and then I approve each finding by hand before it goes on the site. When a range shows up, the entry drops off the next morning.

The design notes that led here are in [docs/FINDINGS.md](docs/FINDINGS.md), and the original spec is [docs/SPEC-v0.1.md](docs/SPEC-v0.1.md). The short version: most big employers disclose on 95%+ of postings, the classifier was wrong five times before it was right, and nothing is evidence until we fetched it ourselves.

## Layout

```
packages/core      adapters (one file per ats), range + jurisdiction classifiers, url handling. no db, no env.
packages/db        drizzle sqlite schema, migrations, three clients (d1 binding, d1 rest, local libsql), diff-only writes
apps/crawler       the cli github actions runs: seed, crawl, finalize, export-site-data, process-submissions, discover
apps/web           next static export: public site + /admin spa. base ui + tailwind
apps/api           hono worker: /api/submit, /api/status, /api/admin/*; serves apps/web/out as static assets
data/              committed inputs: seed board lists, sector taxonomy + tags, curated nyc employers (see data/README.md)
docs/              FINDINGS.md (what the seed analysis taught us), SPEC-v0.1.md (the original plan)
tools/fixtures     boards.txt + the extractor that turns 48 real boards into the golden classifier fixtures
.github/workflows  crawl (daily), process (dispatch + 30 min), deploy (push), discover (weekly), ci
```

## Run it locally

```bash
pnpm install
cp .env.example .env                      # defaults are local sqlite + local blobs, no cloudflare needed
pnpm test && pnpm typecheck

pnpm crawler seed                         # 2,722 boards from data/seed, sectors from data/sectors, 50 workday tenants active
pnpm crawler crawl --vendor ashby --slug polymarket    # one live board, a few requests
pnpm crawler crawl --vendor lever --slug nitra
pnpm crawler finalize                     # nothing confirms until a second crawl >= 20 h later
pnpm crawler export-site-data             # writes apps/web/data/*.json + public/evidence + public/data/findings.csv
pnpm build:web                            # apps/web/out
```

To run the worker and the admin against a local D1:

```bash
cd apps/api
printf 'ADMIN_TOKEN=devtoken\nIP_SALT=devsalt\n' > .dev.vars
pnpm exec wrangler d1 migrations apply jd-reporter --local
pnpm exec wrangler dev                    # http://localhost:8787, admin at /admin with the token
```

The crawler can write straight into wrangler's local D1 file, which is the easiest way to get findings into the admin queue:

```bash
LOCAL_DB_PATH=apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite pnpm crawler seed
LOCAL_DB_PATH=... pnpm crawler crawl --vendor ashby --slug polymarket
# then fast-forward detected_at by 30 h in sqlite and run finalize to see the queue fill
```

Local blobs live in `.local/blobs`, not in wrangler's local R2, so the admin's stored-evidence view 404s in this setup and falls back to the live read. In production both sides use the same R2 bucket.

## Fixtures

The classifier's golden fixtures in `packages/core/test/fixtures` come from 48 real boards ([tools/fixtures/boards.txt](tools/fixtures/boards.txt), the top 12 per vendor by New York volume). `pnpm fixtures` replays a local cache of those boards' responses (`.local/fixture-cache`, gitignored) through the real adapters and rewrites the fixtures; `pnpm fixtures --refresh` re-fetches the boards live first (about 60 polite requests). Rerun after any classifier change and read the summary diff before accepting new expectations. The test suite also pins the board-level facts from FINDINGS (Polymarket 15, Nitra 4+2, Stripe all offsite, the five false alarms at 100%).

## Production runbook

Cloudflare, once:

1. `wrangler d1 create jd-reporter`, paste the id into `apps/api/wrangler.jsonc`, then `wrangler d1 migrations apply jd-reporter --remote`.
2. `wrangler r2 bucket create jd-reporter`, and create an R2 S3 API token (access key + secret) for the crawler.
3. An API token for Actions with D1 edit, R2 edit and Workers Scripts edit.
4. Worker secrets: `wrangler secret put ADMIN_TOKEN`, `TURNSTILE_SECRET`, `GITHUB_TOKEN` (fine-grained, contents: write on this repo, for `repository_dispatch`), `IP_SALT`. Vars in `wrangler.jsonc`: `GITHUB_REPO`, `PUBLIC_ORIGIN`.
5. Custom domain, then a Zero Trust Access application on `/admin*` and `/api/admin/*`; set `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` on the worker and the bearer token stops being needed.
6. Turnstile widget for the site; the site key goes in the `TURNSTILE_SITE_KEY` repo variable.

GitHub: secrets `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `D1_DATABASE_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WAYBACK_ACCESS_KEY`, `WAYBACK_SECRET_KEY`; variables `USER_AGENT` (with a contact url), `R2_BUCKET`, `TURNSTILE_SITE_KEY`, `DISPUTE_EMAIL`. Then set the variable `PIPELINE_ENABLED=true`: until it is set, the crawl, process, discover and deploy workflows skip themselves so the public repo stays green without secrets. `ci` runs regardless.

Seeding D1 (the one time the free write budget matters): `DB_MODE=d1 pnpm crawler seed` is ~6k rows and fine. The first full crawl inserts ~27k postings plus findings, which with index writes lands near the 100k/day cap. Either run the crawl workflow with `limit` set for two nights, or turn on Workers Paid for that month and turn it off after. Every day after that is diff-only and lands around 10-20k writes.

## Launch checklist

- [ ] first full crawl done, `finalize` has run twice, the queue has content
- [ ] work the queue for the first ~200 companies; verify every company name and sector before publishing anything under it
- [ ] 100 published findings hand-audited against the live posting at zero false positives (the whole product)
- [ ] every rejection has a `false_positive_reason`; anything that repeats becomes a fixture and a test
- [ ] `DISPUTE_EMAIL` set and someone reads it; two business day promise on `/dispute`
- [ ] `/methodology` and `/law` read once more against the agency pages (verified 2026-09-05: CCHR online report form takes anonymous tips; NYS DOL complaint form is the combined pay equity / salary history / pay transparency form)
- [ ] Turnstile on, `USER_AGENT` points at the methodology page
- [ ] `/data/findings.csv` downloads and matches the site
- [ ] Actions green for a week

## Things worth knowing

- A failed or partial board fetch never marks postings removed; a board that drops to zero postings after having 10+ is treated as a glitch twice before it is believed.
- Companies and boards are separate tables. Merge two boards into one company from the admin (companies tab, or the api with `mergeIntoId`); the old slug stays as a merged stub.
- History is the R2 blobs, not a table. Every board response whose hash changed is stored gzipped and timestamped, plus a per-posting blob for every detail call. A snapshots table can be back-filled from them later.
- Workday is hand-picked (`--workday-top` at seed time) because it paginates 20 at a time and needs a detail call per posting.

## License

MIT for the code. The published findings dataset (`/data/findings.csv`) is CC BY. The board lists in `data/seed` derive from Feashliaa's dataset (CC BY-NC 4.0).
