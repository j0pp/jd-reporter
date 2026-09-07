import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Placeholder } from '@/components/Placeholder';
import { getCompany, getFinding, getFindings } from '@/lib/data';
import { FINDING_LABEL, fmtDateTime } from '@/lib/format';
import { LAWS } from '@/lib/laws';

export const dynamicParams = false;

// static export needs at least one path; before anything is published, /p/0 is a placeholder page
export function generateStaticParams() {
  const ids = getFindings().map((f) => ({ id: String(f.id) }));
  return ids.length ? ids : [{ id: '0' }];
}

type Params = Promise<{ id: string }>;

// see the note in /c/[slug]: the root layout deliberately sets no url or per-page title for og to inherit
export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const f = getFinding(Number(id));
  if (!f) return { title: 'Evidence' };
  const title = `${f.companyName}: ${f.title} (evidence)`;
  const description = `Read from ${f.companyName}'s own job board on ${fmtDateTime(f.detectedAt)}, this New York posting carried no pay range. The record, and how to check it.`;
  return {
    title,
    description,
    alternates: { canonical: `/p/${f.id}` },
    openGraph: { type: 'article', url: `/p/${f.id}`, title, description },
    twitter: { card: 'summary', title, description },
  };
}

// the evidence page: a dated observation about one web page, with everything needed to check it yourself
export default async function EvidencePage({ params }: { params: Params }) {
  const { id } = await params;
  const f = getFinding(Number(id));
  if (!f && id === '0') return <Placeholder what="No findings have been published yet." />;
  if (!f) notFound();
  const company = getCompany(f.companySlug);

  return (
    <>
      <section className="py-12">
        <Link href={`/c/${f.companySlug}`} className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft hover:text-accent">
          ← {f.companyName}
        </Link>
        <h1 className="mt-2 text-4xl font-black leading-[1] tracking-tight md:text-6xl">{f.title}</h1>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <span className="tag tag-accent">{FINDING_LABEL[f.type] ?? f.type}</span>
          <span className="font-semibold text-ink-soft">{f.locations.join(' · ')}</span>
        </div>
      </section>

      <section className="block p-8 md:p-10">
        <p className="text-2xl font-black leading-snug md:text-3xl">
          As of {fmtDateTime(f.detectedAt)}, this posting did not include a pay range.
        </p>
        <p className="mt-4 max-w-3xl text-lg text-ink-soft">
          A person reviewed it on {fmtDateTime(f.publishedAt)} before it was published here.
          {f.type === 'open_ended_range' ? ' The posting states one bound only.' : ''}
          {f.type === 'placeholder_range' ? ' The posting contains an unfilled pay template, which tells us a range was meant to be there.' : ''}
        </p>
        {f.evidenceSpan ? (
          <blockquote className="mt-6 border-l-8 border-accent bg-paper p-5 font-mono text-sm leading-relaxed">“…{f.evidenceSpan}…”</blockquote>
        ) : (
          <p className="mt-6 font-mono text-sm text-ink-soft">No dollar figure of any kind appeared in the posting text or the employer&apos;s structured pay fields.</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <a href={f.url} target="_blank" rel="noopener noreferrer" className="btn text-xs">
            The posting today ↗
          </a>
          {f.waybackUrl ? (
            <a href={f.waybackUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">
              Wayback Machine copy ↗
            </a>
          ) : null}
          <a href={`/evidence/${f.id}.json`} className="btn btn-ghost text-xs">
            Raw record we read ↗
          </a>
        </div>
      </section>

      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="block-soft p-6">
          <h2 className="text-lg font-black">How we decided</h2>
          <ul className="mt-3 space-y-2 text-sm leading-relaxed">
            <li>
              Source: the employer&apos;s own job board API{f.rangeAtDetection.source.startsWith('employer_page') ? ', then the employer\u2019s own posting page' : ''}.
            </li>
            <li>Classifier version {f.classifierVersion}; reading: {f.rangeAtDetection.method.replace(/_/g, ' ')}.</li>
            {f.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <div className="block-soft p-6">
          <h2 className="text-lg font-black">What the law asks for</h2>
          <ul className="mt-3 space-y-3 text-sm leading-relaxed">
            {LAWS.map((l) => (
              <li key={l.code}>
                <strong>{l.name}</strong> ({l.statuteCite}): {l.coverageRule}{' '}
                <a href={l.complaintUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                  {l.complaintLabel} ↗
                </a>
              </li>
            ))}
          </ul>
          {company ? (
            <p className="mt-4 text-sm text-ink-soft">
              We infer four or more employees from {company.openPostingsTotal} open postings.{' '}
              <Link href="/dispute" className="font-bold underline">
                Dispute this entry
              </Link>
              .
            </p>
          ) : null}
        </div>
      </section>
    </>
  );
}
