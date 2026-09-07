import { RateLimitedError } from '@jdr/core';
import { activeBoardsForCrawl, ensureBoard, findBoard, finishRun, markBoardCrawled, startRun, type Board } from '@jdr/db';
import { Command } from 'commander';
import { crawlBoard, describeError } from './crawl.ts';
import { discover } from './discover.ts';
import { loadConfig, openBlobs, openDb } from './env.ts';
import { exportSiteData } from './export.ts';
import { finalize } from './finalize.ts';
import { processSubmissions } from './process.ts';
import { seed } from './seed.ts';

const log = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`);
const program = new Command().name('jdr').description('jd reporter crawler');

program
  .command('seed')
  .description('load the seed analysis (cohort + candidates csvs) into boards and companies')
  .option('--workday-top <n>', 'how many workday tenants to activate, by nyc volume', '50')
  .action(async (o: { workdayTop: string }) => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    await seed(db, cfg, { workdayTop: Number(o.workdayTop), log });
  });

program
  .command('crawl')
  .description('fetch every active board for one vendor, classify, diff, write')
  .requiredOption('--vendor <vendor>', 'greenhouse | lever | ashby | workday')
  .option('--limit <n>', 'only this many boards, stalest first')
  .option('--slug <slug>', 'one board (created as manual if unknown)')
  .option('--dry-run', 'fetch and classify, write nothing', false)
  .option('--max-detail <n>', 'detail calls per board', '150')
  .option('--max-pages <n>', 'employer page fetches per board', '60')
  .option('--workday-max-pages <n>', 'search pages per workday tenant', '10')
  .option('--max-minutes <n>', 'stop starting new boards after this long', '300')
  .action(async (o: { vendor: string; limit?: string; slug?: string; dryRun: boolean; maxDetail: string; maxPages: string; workdayMaxPages: string; maxMinutes: string }) => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    const blobs = openBlobs(cfg);
    const runId = o.dryRun ? 0 : await startRun(db, 'crawl', o.vendor);
    const started = Date.now();

    let list: Board[];
    if (o.slug) {
      const b = (await findBoard(db, o.vendor, o.slug)) ?? (await ensureBoard(db, { vendor: o.vendor as never, slug: o.slug, discoveredVia: 'manual' })).board;
      list = [b];
    } else {
      list = await activeBoardsForCrawl(db, o.vendor, o.limit ? Number(o.limit) : undefined);
    }
    log(`crawl ${o.vendor}: ${list.length} boards${o.dryRun ? ' (dry run)' : ''}`);

    const totals = { attempted: 0, ok: 0, seen: 0, changed: 0, removed: 0, created: 0, fixed: 0 };
    const errors: { board: string; error: string }[] = [];
    for (const board of list) {
      if (Date.now() - started > Number(o.maxMinutes) * 60_000) {
        log(`crawl ${o.vendor}: time budget reached, ${list.length - totals.attempted} boards wait for tomorrow`);
        break;
      }
      totals.attempted += 1;
      const label = `${board.atsVendor}:${board.atsSlug}`;
      try {
        const r = await crawlBoard(db, blobs, cfg, board, runId, {
          dryRun: o.dryRun,
          maxDetailCalls: Number(o.maxDetail),
          maxPageFetches: Number(o.maxPages),
          workdayMaxPages: Number(o.workdayMaxPages),
          log,
        });
        if (r.ok) {
          totals.ok += 1;
          totals.seen += r.nySeen;
          totals.changed += r.inserted + r.updated;
          totals.removed += r.removed;
          totals.created += r.findings?.created ?? 0;
          totals.fixed += r.findings?.fixed ?? 0;
          const methods = Object.entries(r.methods)
            .filter(([k]) => !['structured', 'text_range', 'fixed_rate'].includes(k))
            .map(([k, v]) => `${k}=${v}`)
            .join(' ');
          log(`${label.padEnd(48)} total=${String(r.postingsTotal).padStart(4)} ny=${String(r.nySeen).padStart(4)} +${r.inserted} ~${r.updated} -${r.removed} =${r.unchanged} detail=${r.detailCalls} pages=${r.pageFetches} ${methods}`);
        } else {
          errors.push({ board: label, error: r.error ?? 'unknown' });
          log(`${label.padEnd(48)} ERROR ${r.error}`);
        }
      } catch (e) {
        const msg = describeError(e);
        errors.push({ board: label, error: msg });
        log(`${label.padEnd(48)} ERROR ${msg}`);
        if (!o.dryRun) await markBoardCrawled(db, board.id, { runId, ok: false, error: msg });
        // the http client already paused; keep going with the next board
        if (e instanceof RateLimitedError) continue;
      }
    }
    if (!o.dryRun) {
      await finishRun(db, runId, {
        boardsAttempted: totals.attempted,
        boardsOk: totals.ok,
        postingsSeen: totals.seen,
        postingsChanged: totals.changed,
        postingsRemoved: totals.removed,
        findingsCreated: totals.created,
        findingsFixed: totals.fixed,
        errors,
      });
    }
    log(`crawl ${o.vendor}: ${totals.ok}/${totals.attempted} boards ok, ${totals.seen} ny postings, ${totals.changed} changed, ${totals.removed} removed, ${totals.created} findings detected, ${errors.length} errors`);
  });

program
  .command('finalize')
  .description('confirm findings seen twice, archive to wayback, queue for review, refresh rollups')
  .option('--wayback-cap <n>', 'captures per run', '100')
  .action(async (o: { waybackCap: string }) => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    await finalize(db, cfg, { waybackCap: Number(o.waybackCap), log });
  });

program
  .command('export-site-data')
  .description('write apps/web/data/*.json and the public findings csv')
  .action(async () => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    await exportSiteData(db, openBlobs(cfg), cfg, { log });
  });

program
  .command('process-submissions')
  .description('drain queued submissions: resolve, crawl if needed, report')
  .option('--limit <n>', 'max submissions this run', '20')
  .action(async (o: { limit: string }) => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    await processSubmissions(db, openBlobs(cfg), cfg, { limit: Number(o.limit), log });
  });

program
  .command('discover')
  .description('diff the feashliaa postings dump against known boards; zero ats requests')
  .option('--activate-workday', 'crawl newly found workday tenants (default: inactive)', false)
  .option('--dry-run', 'count only', false)
  .action(async (o: { activateWorkday: boolean; dryRun: boolean }) => {
    const cfg = loadConfig();
    const db = await openDb(cfg);
    await discover(db, cfg, { activateWorkday: o.activateWorkday, dryRun: o.dryRun, log });
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(e);
  process.exit(1);
});
