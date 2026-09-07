# data/

Committed inputs. None of this is evidence of anything; it only decides where the crawler looks. Every published number comes from our own fetch of the employer's board.

The board list itself is not committed. `pnpm crawler discover` reads the [Feashliaa job-board-data](https://github.com/Feashliaa/job-board-data) dump (CC BY-NC 4.0, used non-commercially with attribution) and creates a `boards` + `companies` row for every Greenhouse, Lever, Ashby or Workday board with at least one New York posting. The first run against an empty database is the bootstrap; the weekly run keeps the list growing. The earlier seed analysis that produced a csv snapshot of the same dump lives in `docs/FINDINGS.md` as design notes only.

## `nyc-employers.csv`

A hand-curated list of 261 large and mid-size New York City employers (name, domain, HQ, headcount estimate, careers url, ATS hints, staffing flag), carried over from an earlier attempt at this project. It is the company-side discovery seed the design calls for: the employers slug lists systematically miss because their board is small, embedded or behind a careers page (hospitals, universities, law firms, agencies, nonprofits). Not wired into `discover` yet.
