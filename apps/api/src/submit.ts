import { classifyPosting, classifySubmittedUrl, createHttp, getAdapter, isNySignal, sha256Hex } from '@jdr/core';
import { submissions } from '@jdr/db/schema';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppEnv } from './env.ts';

export const submitRoutes = new Hono<AppEnv>();

const HOURLY_LIMIT = 10;
const UA = 'jd-reporter/0.1 (submission quick check)';

// the submitter sees the quick answer now and a live status page; the real work happens in actions
submitRoutes.post('/submit', async (c) => {
  const db = c.get('db');
  const body = (await c.req.json().catch(() => null)) as { url?: string; note?: string; turnstileToken?: string } | null;
  if (!body?.url || typeof body.url !== 'string' || body.url.length > 2000) return c.json({ error: 'paste a url' }, 400);

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? '0.0.0.0';
  const ipHash = (await sha256Hex(`${c.env.IP_SALT ?? 'jdr'}:${ip}`)).slice(0, 32);

  if (c.env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET, body.turnstileToken ?? '', ip);
    if (!ok) return c.json({ error: 'the anti-bot check failed, try again' }, 400);
  }

  const since = new Date(Date.now() - 3600_000).toISOString();
  const [recent] = await db
    .select({ n: sql<number>`count(*)` })
    .from(submissions)
    .where(and(eq(submissions.ipHash, ipHash), gt(submissions.createdAt, since)));
  if (Number(recent?.n ?? 0) >= HOURLY_LIMIT) return c.json({ error: 'too many submissions from this address; try again in an hour' }, 429);

  const info = classifySubmittedUrl(body.url);
  if (!info) return c.json({ error: 'that does not look like a url' }, 400);
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  const note = body.note?.slice(0, 500) ?? null;

  if (info.kind === 'aggregator') {
    await db.insert(submissions).values({
      publicToken: token,
      submittedUrl: body.url.slice(0, 2000),
      canonicalUrl: info.canonical,
      sourceType: 'aggregator',
      host: info.host,
      rejectedDomain: info.host,
      status: 'rejected',
      statusMessage: `${info.host} is a job aggregator, and aggregators often lose the range when they copy a posting. Open the job there, click Apply, and paste the employer's own page instead.`,
      note,
      ipHash,
      processedAt: new Date().toISOString(),
    });
    return c.json({ token, status: 'rejected', message: 'aggregator', hint: 'open the job, click apply, paste the employer page url' });
  }

  if (info.kind === 'unknown') {
    await db.insert(submissions).values({
      publicToken: token,
      submittedUrl: body.url.slice(0, 2000),
      canonicalUrl: info.canonical,
      sourceType: 'unknown',
      host: info.host,
      status: 'rejected',
      statusMessage: 'we could not tell what this page is. paste a job posting or a careers page on the employer\u2019s own site, or a greenhouse, lever, ashby or workday link.',
      note,
      ipHash,
      processedAt: new Date().toISOString(),
    });
    return c.json({ token, status: 'rejected', message: 'unknown page type' });
  }

  // same link within a day: hand back the earlier token instead of a second job
  const [dupe] = await db
    .select({ token: submissions.publicToken, status: submissions.status })
    .from(submissions)
    .where(and(eq(submissions.canonicalUrl, info.canonical), gt(submissions.createdAt, new Date(Date.now() - 86_400_000).toISOString())))
    .orderBy(desc(submissions.createdAt))
    .limit(1);
  if (dupe) return c.json({ token: dupe.token, status: dupe.status, message: 'already submitted recently' });

  // quick check: one posting fetch and the classifier, only where a single call is cheap enough for a worker
  let quick: Record<string, unknown> | null = null;
  if (info.kind === 'ats_posting' && info.vendor && info.slug && info.externalId && info.vendor !== 'ashby') {
    try {
      const adapter = getAdapter(info.vendor);
      const http = createHttp({ userAgent: UA, delayMs: 0, maxRetries: 0, timeoutMs: 8000 });
      const raw = await adapter.fetchPosting(info.slug, info.externalId, { http });
      if (raw) {
        const cl = classifyPosting(info.vendor, raw);
        quick = {
          title: raw.title,
          locations: raw.locations,
          method: cl.range.method,
          evidence: cl.range.evidenceSpan ?? null,
          coverage: cl.coverage.coverage,
          inScope: isNySignal(cl.coverage),
          isOffsite: cl.isOffsite,
        };
      } else {
        quick = { notFound: true };
      }
    } catch (e) {
      quick = { error: e instanceof Error ? e.message.slice(0, 120) : 'quick check failed' };
    }
  }

  await db.insert(submissions).values({
    publicToken: token,
    submittedUrl: body.url.slice(0, 2000),
    canonicalUrl: info.canonical,
    sourceType: info.kind,
    host: info.host,
    atsVendor: info.vendor ?? null,
    atsSlug: info.slug ?? null,
    externalId: info.externalId ?? null,
    quickResult: quick,
    status: 'queued',
    statusMessage: quickMessage(quick),
    note,
    ipHash,
  });

  c.executionCtx.waitUntil(dispatchGithub(c.env, token));
  return c.json({ token, status: 'queued', quick });
});

submitRoutes.get('/status/:token', async (c) => {
  const db = c.get('db');
  const [s] = await db.select().from(submissions).where(eq(submissions.publicToken, c.req.param('token'))).limit(1);
  if (!s) return c.json({ error: 'not found' }, 404);
  return c.json({
    token: s.publicToken,
    submittedUrl: s.submittedUrl,
    sourceType: s.sourceType,
    status: s.status,
    message: s.statusMessage,
    quick: s.quickResult,
    createdAt: s.createdAt,
    processedAt: s.processedAt,
    companyId: s.companyId,
    findingId: s.findingId,
  });
});

function quickMessage(q: Record<string, unknown> | null): string {
  if (!q) return 'queued: we will read the employer\u2019s board ourselves and put the result in the review queue';
  if (q.notFound) return 'we could not find that posting on the board right now; queued for a full read';
  if (q.error) return 'queued: the quick check did not complete, the full read will';
  if (q.inScope === false) return `quick check: "${(q.locations as string[]).join('; ') || 'no location'}" does not read as New York, so this posting is out of scope; queued to confirm`;
  const m = String(q.method);
  if (m === 'structured' || m === 'text_range' || m === 'fixed_rate') return `quick check: a pay figure was found (${q.evidence ?? m}); queued to confirm`;
  if (m === 'offsite_unverified') return 'quick check: the board feed has no pay data and the posting lives on the employer\u2019s own site; queued to read that page';
  return `quick check: no pay range detected (${m.replace(/_/g, ' ')}); queued for human review`;
}

async function verifyTurnstile(secret: string, token: string, ip: string): Promise<boolean> {
  if (!token) return false;
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ secret, response: token, remoteip: ip }),
  });
  const json = (await res.json().catch(() => ({}))) as { success?: boolean };
  return json.success === true;
}

// wake the actions workflow; a 30-minute schedule catches anything this misses
async function dispatchGithub(env: AppEnv['Bindings'], token: string) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO) return;
  await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'jd-reporter-worker',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ event_type: 'submission', client_payload: { token } }),
  }).catch(() => undefined);
}
