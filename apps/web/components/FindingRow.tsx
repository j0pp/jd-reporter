import Link from 'next/link';
import type { SiteFinding } from '@/lib/data';
import { FINDING_LABEL, fmtDate } from '@/lib/format';

export function FindingRow({ f, showCompany = false }: { f: SiteFinding; showCompany?: boolean }) {
  return (
    <li className="grid gap-4 border-b-4 border-rule px-6 py-6 last:border-b-0 md:grid-cols-[1fr_auto] md:items-center">
      <div>
        {showCompany ? (
          <Link href={`/c/${f.companySlug}`} className="text-xs font-extrabold uppercase tracking-widest text-ink-soft hover:text-accent">
            {f.companyName}
          </Link>
        ) : null}
        <h3 className="mt-1 text-2xl font-black leading-tight">
          <Link href={`/p/${f.id}`} className="hover:text-accent">
            {f.title}
          </Link>
        </h3>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="tag tag-accent">{FINDING_LABEL[f.type] ?? f.type}</span>
          {f.jurisdictionCodes.includes('nyc') ? <span className="tag">NYC</span> : null}
          {f.jurisdictionCodes.includes('nys') ? <span className="tag">NYS</span> : null}
          <span className="font-semibold text-ink-soft">{f.locations.join(' · ')}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm font-bold md:flex-col md:items-end">
        <span className="text-ink-soft">since {fmtDate(f.detectedAt)}</span>
        <div className="flex gap-3">
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="underline">
            posting ↗
          </a>
          <Link href={`/p/${f.id}`} className="underline">
            evidence →
          </Link>
        </div>
      </div>
    </li>
  );
}
