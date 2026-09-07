import type { Config } from './env.ts';

// archive.org rate-limits by refusing connections, so a run of failures means "stop asking", not "try harder"
const GIVE_UP_AFTER_CONSECUTIVE_FAILURES = 5;

// save page now v2. authenticated keys, a few captures a minute, findings only (never every posting).
// nothing in here throws: an archive we could not take is a missing wayback_url, never a failed pipeline
export async function waybackSave(cfg: Config, url: string, log: (m: string) => void): Promise<string | null> {
  if (!cfg.waybackAccessKey || !cfg.waybackSecretKey) return null;
  const headers = {
    authorization: `LOW ${cfg.waybackAccessKey}:${cfg.waybackSecretKey}`,
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': cfg.userAgent,
  };
  const body = new URLSearchParams({ url, if_not_archived_within: '1d', skip_first_archive: '1' });

  const res = await post('https://web.archive.org/save', { method: 'POST', headers, body }, url, log);
  if (!res) return null;
  if (!res.ok) {
    log(`wayback save failed ${res.status} for ${url}`);
    return null;
  }
  const started = await json<{ job_id?: string }>(res);
  if (!started?.job_id) return null;

  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await post(`https://web.archive.org/save/status/${started.job_id}`, { headers }, url, log);
    if (!st?.ok) continue;
    const j = await json<{ status?: string; timestamp?: string; original_url?: string; message?: string }>(st);
    if (!j) continue;
    if (j.status === 'success' && j.timestamp) return `https://web.archive.org/web/${j.timestamp}/${j.original_url ?? url}`;
    if (j.status === 'error') {
      log(`wayback error for ${url}: ${j.message ?? 'unknown'}`);
      return null;
    }
  }
  log(`wayback timed out for ${url}`);
  return null;
}

// a refused connection, a dns failure or a reset socket is a null, not a throw
async function post(target: string, init: RequestInit, url: string, log: (m: string) => void): Promise<Response | null> {
  try {
    return await fetch(target, init);
  } catch (e) {
    log(`wayback unreachable for ${url}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function json<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// the caller's loop: stops asking once archive.org has clearly stopped answering
export function waybackCircuit(log: (m: string) => void) {
  let consecutiveFailures = 0;
  return {
    get open() {
      return consecutiveFailures >= GIVE_UP_AFTER_CONSECUTIVE_FAILURES;
    },
    record(ok: boolean) {
      consecutiveFailures = ok ? 0 : consecutiveFailures + 1;
      if (consecutiveFailures === GIVE_UP_AFTER_CONSECUTIVE_FAILURES) {
        log(`wayback: ${consecutiveFailures} failures in a row, skipping the rest of this run`);
      }
    },
  };
}
