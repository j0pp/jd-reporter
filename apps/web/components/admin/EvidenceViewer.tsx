'use client';

import { getAdapter, stripHtml, type AtsVendor } from '@jdr/core';
import * as React from 'react';
import { api, fetchBlob } from '@/lib/api';
import type { AdminPosting } from './types';

interface Loaded {
  source: 'blob' | 'live';
  capturedAt: string | null;
  title: string;
  locations: string[];
  text: string;
  structured: unknown;
}

// the description as we read it at detection (from the stored blob) or as it is right now (one vendor call).
// the evidence span is highlighted so the eye lands on the deciding text
export function EvidenceViewer({ posting, rawKey, evidenceSpan }: { posting: AdminPosting; rawKey: string | null; evidenceSpan: string | null }) {
  const [data, setData] = React.useState<Loaded | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const loadBlob = React.useCallback(async () => {
    if (!rawKey) return;
    setBusy(true);
    setErr(null);
    try {
      const blob = (await fetchBlob(rawKey)) as {
        capturedAt?: string;
        board?: { vendor: string; slug: string };
        responses?: { url: string; body: string }[];
        response?: unknown;
      };
      const vendor = (blob.board?.vendor ?? rawKey.split('/')[1]) as AtsVendor;
      const adapter = getAdapter(vendor);
      let found: ReturnType<typeof adapter.normalizeBoard>[number] | undefined;
      if (blob.response !== undefined) {
        found = normalizeDetail(vendor, blob.response, adapter);
      } else {
        for (const r of blob.responses ?? []) {
          let json: unknown;
          try {
            json = JSON.parse(r.body);
          } catch {
            continue;
          }
          found = adapter.normalizeBoard(json).find((p) => p.externalId === posting.externalId || p.url === posting.canonicalUrl);
          if (found) break;
        }
      }
      if (!found) throw new Error('posting not found inside the stored blob');
      setData({ source: 'blob', capturedAt: blob.capturedAt ?? null, title: found.title, locations: found.locations, text: found.descriptionText, structured: found.structuredComp });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load blob');
    } finally {
      setBusy(false);
    }
  }, [rawKey, posting]);

  const loadLive = React.useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const live = await api<{ title: string; locations: string[]; text: string; structured: unknown }>(`/api/admin/postings/${posting.id}/live`, { admin: true });
      setData({ source: 'live', capturedAt: new Date().toISOString(), ...live });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'live fetch failed');
    } finally {
      setBusy(false);
    }
  }, [posting.id]);

  React.useEffect(() => {
    setData(null);
    // no stored blob (local dev, or a blob written before r2 was configured): fall back to the live read
    void loadBlob().then(() => {
      if (posting.board.vendor !== 'ashby') {
        setErr((e) => {
          if (e) void loadLive();
          return e;
        });
      }
    });
  }, [loadBlob, loadLive, posting.board.vendor]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'l' && !e.metaKey && !e.ctrlKey && (e.target as HTMLElement)?.tagName !== 'INPUT' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') void loadLive();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadLive]);

  return (
    <div className="block p-4 md:p-6">
      <div className="flex flex-wrap items-center gap-3 text-xs font-extrabold uppercase tracking-widest text-ink-soft">
        <span>{data ? (data.source === 'blob' ? `as read ${data.capturedAt ? new Date(data.capturedAt).toLocaleString() : ''}` : 'live, right now') : 'loading…'}</span>
        <span className="flex-1" />
        <button className="btn btn-ghost py-1 px-2 text-[10px]" onClick={() => void loadBlob()} disabled={busy || !rawKey}>
          stored
        </button>
        <button className="btn btn-ghost py-1 px-2 text-[10px]" onClick={() => void loadLive()} disabled={busy}>
          live (L)
        </button>
      </div>
      {err ? <p className="mt-3 font-bold text-accent">{err}</p> : null}
      {data ? (
        <>
          <div className="mt-3 text-sm font-bold text-ink-soft">
            {data.title} · {data.locations.join('; ') || 'no location'}
          </div>
          {data.structured ? <pre className="mt-3 overflow-x-auto bg-paper p-3 font-mono text-xs">structured: {JSON.stringify(data.structured)}</pre> : null}
          <div className="mt-3 max-h-[28rem] overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">{highlight(data.text, evidenceSpan)}</div>
        </>
      ) : null}
    </div>
  );
}

function normalizeDetail(vendor: AtsVendor, response: unknown, adapter: ReturnType<typeof getAdapter>) {
  if (vendor === 'greenhouse') return adapter.normalizeBoard({ jobs: [response] })[0];
  if (vendor === 'lever') return adapter.normalizeBoard([response])[0];
  if (vendor === 'ashby') return adapter.normalizeBoard({ jobs: [response] })[0];
  // workday detail blobs hold { list, detail }
  const r = response as { list?: unknown; detail?: { jobPostingInfo?: Record<string, unknown> } };
  const info = r.detail?.jobPostingInfo ?? {};
  return {
    externalId: String(info.jobReqId ?? ''),
    url: String(info.externalUrl ?? ''),
    title: String(info.title ?? ''),
    locations: [String(info.location ?? ''), ...((info.additionalLocations as string[] | undefined) ?? [])].filter(Boolean),
    isRemote: null,
    descriptionText: stripHtml(String(info.jobDescription ?? '')),
    structuredComp: null,
    employmentType: null,
    publishedAt: null,
    updatedAt: null,
    needsDetail: false,
    raw: response,
  };
}

function highlight(text: string, span: string | null) {
  if (!span) return text;
  // the span is a window around the match; find its core (the part with the dollar sign) for a tighter mark
  const core = span.match(/\$[^]{0,40}/)?.[0] ?? span.slice(0, 60);
  const idx = text.indexOf(core);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-accent px-1 text-white">{text.slice(idx, idx + core.length)}</mark>
      {text.slice(idx + core.length)}
    </>
  );
}
