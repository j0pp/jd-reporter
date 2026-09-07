'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { fmtDateTime } from '@/lib/format';
import type { AdminSubmission } from './types';

interface Resp {
  submissions: AdminSubmission[];
  rejectedHosts: { host: string; n: number }[];
}

const STATUS_CLASS: Record<string, string> = {
  queued: 'border-warn text-warn',
  processing: 'border-warn text-warn',
  verified: 'border-ok text-ok',
  published: 'bg-ok border-ok text-white',
  rejected: 'text-muted border-muted',
  error: 'tag-accent',
};

export function SubmissionsTab() {
  const [data, setData] = React.useState<Resp | null>(null);
  React.useEffect(() => {
    void api<Resp>('/api/admin/submissions?limit=200', { admin: true }).then(setData);
  }, []);
  if (!data) return <p className="text-ink-soft">Loading…</p>;
  return (
    <div className="space-y-6">
      {data.rejectedHosts.length ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-extrabold uppercase tracking-widest text-ink-soft">rejected hosts</span>
          {data.rejectedHosts.map((h) => (
            <span key={h.host} className="tag">
              {h.host} · {h.n}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="block divide-y-2 divide-rule/20">
        {data.submissions.map((s) => (
          <li key={s.id} className="grid gap-2 px-4 py-3 md:grid-cols-[8rem_1fr_16rem]">
            <span className={`tag self-start ${STATUS_CLASS[s.status] ?? ''}`}>{s.status}</span>
            <div className="min-w-0">
              <a href={s.submittedUrl} target="_blank" rel="noopener noreferrer" className="block truncate font-bold underline">
                {s.submittedUrl}
              </a>
              <div className="mt-1 text-sm text-ink-soft">{s.statusMessage}</div>
              {s.quickResult ? <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-ink-soft">{JSON.stringify(s.quickResult)}</pre> : null}
            </div>
            <div className="text-xs font-semibold text-ink-soft">
              {s.sourceType} · {fmtDateTime(s.createdAt)}
              <br />
              {s.processedAt ? `processed ${fmtDateTime(s.processedAt)}` : 'not processed yet'}
              {s.findingId ? ` · finding #${s.findingId}` : ''}
            </div>
          </li>
        ))}
        {!data.submissions.length ? <li className="px-4 py-6 text-ink-soft">No submissions yet.</li> : null}
      </ul>
    </div>
  );
}
