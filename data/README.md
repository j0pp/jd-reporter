# data/

Committed inputs. None of this is evidence of anything; it only decides where the crawler looks and how companies are labelled. Every published number comes from our own fetch of the employer's board.

## `seed/`

`cohort.csv` and `candidates.csv`, exported on 2026-09-05 from the seed analysis described in [docs/FINDINGS.md](../docs/FINDINGS.md). They are derived from the [Feashliaa job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator) dump (data CC BY-NC 4.0, used non-commercially with attribution): one row per Greenhouse, Lever, Ashby or Workday board with at least one New York posting, with counts, a recruiter flag and a sector guess. `pnpm crawler seed` loads them into `boards` and `companies`. After that, the weekly `discover` job keeps the list growing straight from the dump; these files are only the starting point.

## `sectors/`

`sectors.csv` is the taxonomy (18 buckets, each mapped to a NAICS 2-digit code). `sector_agent.csv` is one LLM pass over 1,391 cohort boards (slug, domain, top job titles) with a confidence. `sector_manual.csv` is hand fixes and always wins. `seed` applies manual over agent over whatever the export row carried; the admin can override any company afterwards.

## `nyc-employers.csv`

A hand-curated list of 261 large and mid-size New York City employers (name, domain, HQ, headcount estimate, careers url, ATS hints, staffing flag), carried over from an earlier attempt at this project. It is the company-side discovery seed the design calls for: the employers slug lists systematically miss because their board is small, embedded or behind a careers page (hospitals, universities, law firms, agencies, nonprofits). Not wired into `discover` yet.
