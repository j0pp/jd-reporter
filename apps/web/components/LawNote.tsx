import type { SiteCompany } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import { LAWS } from '@/lib/laws';

// the conditional legal sentence. never "violation", "illegal", "penalty": we describe a page and state the rule
export function LawNote({ company }: { company: SiteCompany }) {
  return (
    <aside className="block-soft p-6 md:p-8">
      <h2 className="text-xl font-black">Why we believe the pay-range laws apply here</h2>
      <p className="mt-3 max-w-3xl leading-relaxed">
        New York City and New York State each require a good-faith minimum and maximum pay in every advertisement for a job by an employer with four or more
        employees, when the work can be performed at least partly in New York. We believe this applies to the postings above because each one lists a New York
        location, and because this employer had <strong className="num">{company.openPostingsTotal}</strong> open positions on{' '}
        {fmtDate(company.rollupAt)}, which is how we infer four or more employees. If that is wrong,{' '}
        <a href="/dispute" className="font-bold underline">
          tell us
        </a>{' '}
        and we will fix it within two business days.
      </p>
      <p className="mt-3 max-w-3xl leading-relaxed text-ink-soft">
        Under the city law, an employer who fixes a first posting within 30 days of a complaint owes nothing. Most employers on this site fixed theirs before anyone
        filed anything.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        {LAWS.map((l) => (
          <a key={l.code} href={l.complaintUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost text-xs">
            {l.complaintLabel} ↗
          </a>
        ))}
      </div>
    </aside>
  );
}
