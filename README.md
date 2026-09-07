# JD Reporter

A public ledger of New York job postings that did not include a pay range. It reads each employer's own job board (Greenhouse, Lever, Ashby, Workday) every day, classifies every New York posting, and then I approve each finding by hand before it goes on the site. When a range shows up, the entry drops off the next morning.

The design notes that led here are in [docs/FINDINGS.md](docs/FINDINGS.md), and the original spec is [docs/SPEC-v0.1.md](docs/SPEC-v0.1.md). The short version: most big employers disclose on 95%+ of postings, the classifier was wrong five times before it was right, and nothing is evidence until we fetched it ourselves.

## Layout

```
packages/core      adapters (one file per ats), range + ny coverage classifiers, url handling. no db, no env.
packages/db        drizzle sqlite schema, migrations, three clients (d1 binding, d1 rest, local libsql), diff-only writes
apps/crawler       the cli github actions runs: discover, crawl, enrich, finalize, export-site-data, process-submissions
apps/web           next static export: public site + /admin spa. base ui + tailwind
apps/api           hono worker: /api/submit, /api/status, /api/admin/*; serves apps/web/out as static assets
data/              committed inputs: a curated nyc employers list (see data/README.md). the board list comes from discover
docs/              FINDINGS.md (what the seed analysis taught us), SPEC-v0.1.md (the original plan)
tools/fixtures     boards.txt + the extractor that turns 48 real boards into the golden classifier fixtures
.github/workflows  crawl (daily), process (dispatch + 30 min), deploy (push), discover (weekly), ci
```

## Run it locally

```bash
pnpm install
cp .env.example .env                      # defaults are local sqlite + local blobs, no cloudflare needed
pnpm test && pnpm typecheck

pnpm crawler discover                     # ~2,700 boards with a ny posting from the feashliaa dump (~75 mb download, zero ats requests)
pnpm crawler enrich --limit 20            # real names + logos from the vendors' board pages (two requests per board, once)
pnpm crawler crawl --vendor ashby --slug polymarket    # one live board, a few requests
pnpm crawler crawl --vendor lever --slug nitra
pnpm crawler finalize                     # wayback captures for the queue (needs keys) + company rollups
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
LOCAL_DB_PATH=apps/api/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite pnpm crawler discover
LOCAL_DB_PATH=... pnpm crawler crawl --vendor ashby --slug polymarket    # the queue fills on this crawl
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

GitHub: secrets `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `D1_DATABASE_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WAYBACK_ACCESS_KEY`, `WAYBACK_SECRET_KEY`; variables `USER_AGENT` (with a contact url), `R2_BUCKET`, `SITE_ORIGIN` (the public `https://` origin; canonical urls, og tags, `robots.txt` and `sitemap.xml` are built from it and default to localhost without it), `TURNSTILE_SITE_KEY`, `DISPUTE_EMAIL`. The crawl, process, discover and deploy workflows run unconditionally and fail loudly if a secret is missing — they used to gate themselves on a `PIPELINE_ENABLED` variable, but a pipeline that silently skips itself looks identical to one that is working, so a fork without secrets gets red workflows rather than a repo that lies. `ci` needs no secrets and runs anywhere.

Bootstrapping D1 (the one time the free write budget matters): the first `DB_MODE=d1 pnpm crawler discover` is ~5.5k rows (a company and a board per slug) and fine. The first full crawl inserts ~27k postings plus findings, which with index writes lands near the 100k/day cap. Either run the crawl workflow with `limit` set for two nights, or turn on Workers Paid for that month and turn it off after. Every day after that is diff-only and lands around 10-20k writes.

## Launch checklist

- [ ] first full crawl done, the queue has content
- [ ] work the queue for the first ~200 companies; verify every company name before publishing anything under it
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
- Workday is the expensive vendor: it paginates 20 at a time and needs a detail call per posting. Every tenant discover finds is crawled; the throttles are `--workday-max-pages`, `--max-detail` and `--max-minutes` on the crawl, and a tenant you never want can be set `inactive` in the admin.
- Sector is not filled in by anything yet. The column and the admin dropdown are there for when there is a trustworthy source; the public pages do not show it until then.
- Slugs are not names. Each board's first crawl (or `pnpm crawler enrich`, also the `task: enrich` option on the crawl workflow) reads the vendor's public board page once for the company's real name and logo. The name is applied only while the company is unverified; the logo is fetched either way. Logos are stored in R2 under `logos/` and exported as static files to `apps/web/public/logos`; companies without one get a monogram tile. Workday pages are js-rendered, so those names are set in the admin verify card.

## License

MIT for the code. The published findings dataset (`/data/findings.csv`) is CC BY. `discover` decides where to look by reading Feashliaa's job-board-data dump (CC BY-NC 4.0); nothing from it is republished.
