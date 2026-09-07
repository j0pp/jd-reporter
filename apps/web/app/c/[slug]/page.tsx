import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FindingRow } from '@/components/FindingRow';
import { LawNote } from '@/components/LawNote';
import { Placeholder } from '@/components/Placeholder';
import { StatTile } from '@/components/StatTile';
import { getCompanies, getCompany, getFindingsForCompany, getSite } from '@/lib/data';
import { fmtDate, fmtInt, pct, sectorLabel } from '@/lib/format';

export const dynamicParams = false;

export function generateStaticParams() {
  const slugs = getCompanies().map((c) => ({ slug: c.slug }));
  return slugs.length ? slugs : [{ slug: '_none' }];
}

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const c = getCompany(slug);
  return { title: c ? `${c.displayName}: New York postings without a pay range` : 'Company' };
}

const VENDOR_LABEL: Record<string, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday' };

export default async function CompanyPage({ params }: { params: Params }) {
  const { slug } = await params;
  const c = getCompany(slug);
  if (!c && slug === '_none') return <Placeholder what="No companies have been crawled yet." />;
  if (!c) notFound();
  const findings = getFindingsForCompany(c.slug);
  const site = getSite();

  return (
    <>
      <section className="py-12">
        <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">{sectorLabel(c.sector)}</div>
        <h1 className="mt-2 text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">{c.displayName}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm font-bold">
          {c.hqCity ? <span className="tag">HQ {c.hqCity}{c.hqState ? `, ${c.hqState}` : ''}</span> : null}
          {c.boards.map((b) => (
            <a key={`${b.vendor}:${b.slug}`} href={b.url} target="_blank" rel="noopener noreferrer" className="tag hover:bg-ink hover:text-white">
              {VENDOR_LABEL[b.vendor] ?? b.vendor} board ↗
            </a>
          ))}
          <span className="text-ink-soft">last read {fmtDate(c.boards.map((b) => b.lastOkAt).sort().at(-1) ?? null)}</span>
        </div>
      </section>

      {!c.inCohort ? (
        <div className="block-soft mb-8 border-warn p-6 text-lg font-semibold">
          {c.isStaffingFirm ? (
            <>This looks like a staffing or recruiting firm. Both laws exempt temporary help firms, so this company is listed but not scored.</>
          ) : (
            <>
              This employer has <span className="num font-black">{c.openPostingsTotal}</span> open postings, fewer than the five we require before inferring it has four or more
              employees. It is listed here but not scored and cannot appear on the leaderboard.
            </>
          )}
        </div>
      ) : null}

      <section className="grid gap-6 md:grid-cols-3">
        <StatTile label="NY postings open" value={fmtInt(c.openPostingsNy)} sub={`${fmtInt(c.openPostingsTotal)} postings on the board overall`} />
        <StatTile label="Disclosed a range" value={pct(c.disclosedNy, c.openPostingsNy)} sub={`${fmtInt(c.disclosedNy)} of ${fmtInt(c.openPostingsNy)}`} />
        <StatTile label="Current findings" value={fmtInt(findings.length)} accent={findings.length > 0} sub={findings.length ? 'published after review' : 'nothing published'} />
      </section>

      <section className="mt-16">
        <h2 className="border-b-4 border-rule pb-4 text-3xl font-black tracking-tight md:text-4xl">
          {findings.length ? `${findings.length} posting${findings.length === 1 ? '' : 's'} without a pay range` : 'No current findings'}
        </h2>
        {findings.length ? (
          <ul className="block mt-8">
            {findings.map((f) => (
              <FindingRow key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <p className="mt-6 max-w-3xl text-lg text-ink-soft">
            Every New York posting we read on this board either stated a pay range or a single pay figure, or is still waiting for a second read and a human review.
            {c.verified ? '' : ' The company name shown here has not yet been verified by a person.'}
          </p>
        )}
      </section>

      {c.inCohort && findings.length ? (
        <section className="mt-12">
          <LawNote company={c} laws={site.jurisdictions} />
        </section>
      ) : null}
    </>
  );
}
