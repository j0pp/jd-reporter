'use client';

import { Dialog } from '@base-ui/react/dialog';
import * as React from 'react';
import { api } from '@/lib/api';
import { FINDING_LABEL, fmtDateTime } from '@/lib/format';
import { CompanyCard } from './CompanyCard';
import { EvidenceViewer } from './EvidenceViewer';
import { FP_REASONS, type AdminCompany, type QueueGroup, type QueueItem } from './types';

interface Queue {
  groups: QueueGroup[];
  counts: { needsReview: number; detected: number; published: number };
}

// one finding per screen, keyboard first: p publish, r reject, s snooze, v verify company, j/k next/prev, l live
export function QueueTab({ onChanged }: { onChanged: () => void }) {
  const [queue, setQueue] = React.useState<Queue | null>(null);
  const [gi, setGi] = React.useState(0);
  const [ii, setIi] = React.useState(0);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [flash, setFlash] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const q = await api<Queue>('/api/admin/queue', { admin: true });
    setQueue(q);
    setGi((g) => Math.min(g, Math.max(0, q.groups.length - 1)));
    setIi(0);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const group = queue?.groups[gi];
  const item: QueueItem | undefined = group?.items[ii];

  const advance = React.useCallback(() => {
    if (!queue) return;
    const g = queue.groups[gi];
    if (g && ii + 1 < g.items.length) setIi(ii + 1);
    else if (gi + 1 < queue.groups.length) {
      setGi(gi + 1);
      setIi(0);
    }
  }, [queue, gi, ii]);

  const retreat = React.useCallback(() => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) {
      setGi(gi - 1);
      setIi(Math.max(0, (queue?.groups[gi - 1]?.items.length ?? 1) - 1));
    }
  }, [queue, gi, ii]);

  const act = React.useCallback(
    async (action: 'publish' | 'reject' | 'snooze', extra: Record<string, unknown> = {}) => {
      if (!item || busy) return;
      setBusy(true);
      setFlash(null);
      try {
        const r = await api<{ ok: boolean; status: string }>(`/api/admin/findings/${item.finding.id}`, { method: 'POST', admin: true, body: JSON.stringify({ action, ...extra }) });
        setFlash(`${action}: ${r.status}`);
        // drop the item locally so the next one appears without a round trip
        setQueue((q) => {
          if (!q) return q;
          const groups = q.groups
            .map((g, idx) => (idx === gi ? { ...g, items: g.items.filter((x) => x.finding.id !== item.finding.id) } : g))
            .filter((g) => g.items.length > 0);
          return { ...q, groups, counts: { ...q.counts, needsReview: q.counts.needsReview - 1, published: q.counts.published + (action === 'publish' ? 1 : 0) } };
        });
        setIi((i) => Math.max(0, Math.min(i, (group?.items.length ?? 1) - 2)));
        onChanged();
      } catch (e) {
        setFlash(e instanceof Error ? e.message : 'failed');
      } finally {
        setBusy(false);
      }
    },
    [item, busy, gi, group, onChanged],
  );

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (rejectOpen) return;
      switch (e.key.toLowerCase()) {
        case 'p':
          void act('publish');
          break;
        case 'r':
          setRejectOpen(true);
          break;
        case 's':
          void act('snooze', { snoozeDays: 7 });
          break;
        case 'j':
        case 'arrowdown':
          advance();
          break;
        case 'k':
        case 'arrowup':
          retreat();
          break;
        case 'v':
          if (group && !group.company.verifiedAt) void verifyCompany(group.company);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, advance, retreat, rejectOpen, group]);

  async function verifyCompany(c: AdminCompany) {
    const updated = await api<AdminCompany>(`/api/admin/companies/${c.id}`, { method: 'POST', admin: true, body: JSON.stringify({ verify: true }) });
    replaceCompany(updated);
  }

  function replaceCompany(updated: AdminCompany) {
    setQueue((q) => (q ? { ...q, groups: q.groups.map((g) => (g.company.id === updated.id ? { ...g, company: { ...g.company, ...updated } } : g)) } : q));
    onChanged();
  }

  if (!queue) return <p className="text-ink-soft">Loading the queue…</p>;
  if (!queue.groups.length) {
    return (
      <div className="block p-10 text-center">
        <p className="text-3xl font-black">Queue is empty.</p>
        <p className="mt-2 text-ink-soft">
          {queue.counts.detected} findings are waiting for their second crawl. {queue.counts.published} are published.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside className="block max-h-[80vh] overflow-y-auto">
        {queue.groups.map((g, idx) => (
          <button
            key={g.company.id}
            onClick={() => {
              setGi(idx);
              setIi(0);
            }}
            className={`flex w-full items-center justify-between gap-2 border-b-2 border-rule/20 px-4 py-3 text-left ${idx === gi ? 'bg-ink text-white' : 'hover:bg-paper'}`}
          >
            <span className="truncate font-bold">{g.company.displayName}</span>
            <span className="num text-sm font-black">{g.items.length}</span>
          </button>
        ))}
      </aside>

      {group && item ? (
        <section className="space-y-4">
          <CompanyCard company={group.company} onSaved={replaceCompany} compact />

          <div className="block p-5 md:p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="tag tag-accent">{FINDING_LABEL[item.finding.type] ?? item.finding.type}</span>
              {item.finding.jurisdictionCodes.map((c) => (
                <span key={c} className="tag">
                  {c.toUpperCase()}
                </span>
              ))}
              {item.finding.reviewReasons.map((r) => (
                <span key={r} className="tag border-warn text-warn">
                  {r.replace(/_/g, ' ')}
                </span>
              ))}
              <span className="flex-1" />
              <span className="num font-bold text-ink-soft">
                {ii + 1} / {group.items.length} · {queue.counts.needsReview} in queue
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-black leading-tight">{item.posting.title}</h2>
            <div className="mt-2 text-sm font-bold text-ink-soft">
              {item.posting.locations.join(' · ') || 'no location string'} · {item.posting.board.vendor}:{item.posting.board.slug} · {item.posting.employmentType ?? 'type unknown'}
              {item.posting.isOffsite ? ' · offsite posting' : ''}
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {item.posting.jurisdiction.reasons.map((r) => (
                <li key={r}>· {r}</li>
              ))}
              <li>
                · classifier {item.finding.classifierVersion} read this as <strong>{item.finding.rangeAtDetection.method.replace(/_/g, ' ')}</strong> (confidence{' '}
                {item.finding.rangeAtDetection.confidence}); current read: <strong>{item.posting.range.method.replace(/_/g, ' ')}</strong>
              </li>
              <li>
                · detected {fmtDateTime(item.finding.detectedAt)}, confirmed {fmtDateTime(item.finding.confirmedAt)}
              </li>
            </ul>
            {item.finding.evidenceSpan ? <blockquote className="mt-4 border-l-8 border-accent bg-paper p-4 font-mono text-sm">…{item.finding.evidenceSpan}…</blockquote> : null}
            <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
              <a href={item.posting.canonicalUrl} target="_blank" rel="noopener noreferrer" className="underline">
                open posting ↗
              </a>
              {item.finding.waybackUrl ? (
                <a href={item.finding.waybackUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  wayback ↗
                </a>
              ) : (
                <span className="text-ink-soft">no wayback capture yet</span>
              )}
            </div>
          </div>

          <EvidenceViewer posting={item.posting} rawKey={item.finding.firstRawKey ?? item.posting.rawKey} evidenceSpan={item.finding.evidenceSpan} />

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn" disabled={busy} onClick={() => void act('publish')}>
              Publish (P)
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => setRejectOpen(true)}>
              Reject (R)
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={() => void act('snooze', { snoozeDays: 7 })}>
              Snooze 7d (S)
            </button>
            <span className="flex-1" />
            <button className="btn btn-ghost py-2 px-3 text-xs" onClick={retreat}>
              ↑ prev (K)
            </button>
            <button className="btn btn-ghost py-2 px-3 text-xs" onClick={advance}>
              next (J) ↓
            </button>
            {flash ? <span className="font-bold text-ink-soft">{flash}</span> : null}
          </div>

          <RejectDialog open={rejectOpen} onOpenChange={setRejectOpen} onReject={(reason, fp) => void act('reject', { reason, falsePositiveReason: fp })} />
        </section>
      ) : null}
    </div>
  );
}

function RejectDialog({ open, onOpenChange, onReject }: { open: boolean; onOpenChange: (o: boolean) => void; onReject: (reason: string, fp: string) => void }) {
  const [fp, setFp] = React.useState<string>('parser_missed_format');
  const [reason, setReason] = React.useState('');
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-ink/50" />
        <Dialog.Popup className="block fixed left-1/2 top-1/2 z-50 w-[min(40rem,92vw)] -translate-x-1/2 -translate-y-1/2 p-6 shadow-[10px_10px_0_#111]">
          <Dialog.Title className="text-2xl font-black">Reject: why were we wrong?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-ink-soft">The reason becomes a column and, ideally, a regression test.</Dialog.Description>
          <form
            className="mt-4 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              onReject(reason, fp);
              onOpenChange(false);
              setReason('');
            }}
          >
            <select value={fp} onChange={(e) => setFp(e.target.value)} className="block h-11 w-full px-3 font-bold" autoFocus>
              {FP_REASONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="note (optional): what did the posting actually say?" className="block h-24 w-full p-3 text-sm" />
            <div className="flex justify-end gap-2">
              <Dialog.Close className="btn btn-ghost py-2 px-3 text-xs">Cancel</Dialog.Close>
              <button type="submit" className="btn py-2 px-3 text-xs">
                Reject
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
