'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';

interface Status {
  token: string;
  submittedUrl: string;
  sourceType: string;
  status: string;
  message: string | null;
  quick: Record<string, unknown> | null;
  createdAt: string;
  processedAt: string | null;
  findingId: number | null;
}

const STEPS = ['queued', 'processing', 'verified', 'published'];

// polls while the submission is still moving; the real work is in github actions
export function StatusView() {
  const params = useSearchParams();
  const token = params.get('t') ?? '';
  const [s, setS] = React.useState<Status | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!token) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api<Status>(`/api/status/${encodeURIComponent(token)}`);
        if (stop) return;
        setS(r);
        if (r.status === 'queued' || r.status === 'processing') setTimeout(tick, 15_000);
      } catch (e) {
        if (!stop) setError(e instanceof ApiError && e.status === 404 ? 'no submission with that token' : 'could not load status');
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [token]);

  if (!token) return <p className="text-ink-soft">No token in the url.</p>;
  if (error) return <p className="font-bold text-accent">{error}</p>;
  if (!s) return <p className="text-ink-soft">Loading…</p>;

  const stepIdx = STEPS.indexOf(s.status);
  return (
    <div className="space-y-6">
      <div className="block p-6 md:p-8">
        <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">{s.sourceType.replace(/_/g, ' ')}</div>
        <a href={s.submittedUrl} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-lg font-bold underline">
          {s.submittedUrl}
        </a>
        <div className="mt-6 grid grid-cols-4 gap-2">
          {STEPS.map((st, i) => (
            <div key={st} className={`border-4 border-rule p-3 text-center text-xs font-extrabold uppercase tracking-wider ${i <= stepIdx ? 'bg-ink text-white' : s.status === 'rejected' || s.status === 'error' ? 'opacity-30' : ''}`}>
              {st === 'verified' ? 'read' : st}
            </div>
          ))}
        </div>
        {s.status === 'rejected' || s.status === 'error' ? <div className="mt-3 tag tag-accent">{s.status}</div> : null}
        <p className="mt-6 text-xl font-bold leading-snug">{s.message ?? 'Waiting for the reader to pick this up.'}</p>
        <p className="mt-2 text-sm text-ink-soft">
          Submitted {fmtDateTime(s.createdAt)}. {s.processedAt ? `Processed ${fmtDateTime(s.processedAt)}.` : 'Processing usually takes a few minutes; this page refreshes itself.'}
        </p>
        {s.quick && !s.quick.error ? (
          <div className="mt-6 border-t-4 border-rule pt-4 text-sm">
            <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">Quick check</div>
            <ul className="mt-2 space-y-1">
              {s.quick.title ? <li>Title: {String(s.quick.title)}</li> : null}
              {Array.isArray(s.quick.locations) ? <li>Location: {(s.quick.locations as string[]).join('; ') || 'none'}</li> : null}
              {s.quick.method ? <li>Reading: {String(s.quick.method).replace(/_/g, ' ')}</li> : null}
              {s.quick.evidence ? <li className="font-mono text-xs">…{String(s.quick.evidence)}…</li> : null}
            </ul>
          </div>
        ) : null}
      </div>
      <p className="text-sm text-ink-soft">
        Bookmark this page: <code className="font-mono">/s?t={s.token}</code>. Back to the{' '}
        <Link href="/" className="font-bold underline">
          leaderboard
        </Link>
        .
      </p>
    </div>
  );
}
