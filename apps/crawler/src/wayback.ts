import type { Config } from './env.ts';

// save page now v2. authenticated keys, a few captures a minute, findings only (never every posting)
export async function waybackSave(cfg: Config, url: string, log: (m: string) => void): Promise<string | null> {
  if (!cfg.waybackAccessKey || !cfg.waybackSecretKey) return null;
  const headers = {
    authorization: `LOW ${cfg.waybackAccessKey}:${cfg.waybackSecretKey}`,
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
    'user-agent': cfg.userAgent,
  };
  const body = new URLSearchParams({ url, if_not_archived_within: '1d', skip_first_archive: '1' });
  const res = await fetch('https://web.archive.org/save', { method: 'POST', headers, body });
  if (!res.ok) {
    log(`wayback save failed ${res.status} for ${url}`);
    return null;
  }
  const { job_id: jobId } = (await res.json()) as { job_id?: string };
  if (!jobId) return null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await fetch(`https://web.archive.org/save/status/${jobId}`, { headers });
    if (!st.ok) continue;
    const j = (await st.json()) as { status?: string; timestamp?: string; original_url?: string; message?: string };
    if (j.status === 'success' && j.timestamp) return `https://web.archive.org/web/${j.timestamp}/${j.original_url ?? url}`;
    if (j.status === 'error') {
      log(`wayback error for ${url}: ${j.message ?? 'unknown'}`);
      return null;
    }
  }
  log(`wayback timed out for ${url}`);
  return null;
}
