import type { Metadata } from 'next';
import { getSite } from '@/lib/data';

export const metadata: Metadata = { title: 'The law: NYC and New York State pay range requirements' };

export default function Law() {
  const site = getSite();
  return (
    <article className="prose-block max-w-3xl py-12 text-lg leading-relaxed">
      <h1 className="text-5xl font-black leading-[0.95] tracking-tight md:text-6xl">The two laws</h1>
      <p className="mt-6 text-ink-soft">
        Plain-language summary, not legal advice. Both are civil laws enforced by an agency. Nobody on this site is accused of a crime.
      </p>

      <h2>New York City</h2>
      <p>
        NYC Admin. Code § 8-107(32), in effect since November 1, 2022. Employers with four or more employees (at least one working in the city; owners count)
        must state a good-faith minimum and maximum salary or hourly wage in every advertisement for a job, promotion or transfer that can or will be performed at
        least in part in New York City. This includes internal postings and remote-eligible roles. Temporary help firms are exempt. Enforced by the NYC Commission
        on Human Rights. On a first complaint the employer has 30 days to fix the posting and owes nothing if it does.
      </p>

      <h2>New York State</h2>
      <p>
        NY Labor Law § 194-b, in effect since September 17, 2023. Employers with four or more employees must include the compensation or range of compensation
        in any advertisement for a job that will be physically performed at least in part in New York State, or performed outside the state but reporting to a
        supervisor, office or worksite in the state. The advertisement must also include the job description if one exists. Temporary help firms are exempt.
        Enforced by the New York State Department of Labor.
      </p>

      <h2>How this site uses them</h2>
      <ul>
        <li>A city posting is covered by both laws; an upstate posting by the state law only. Each finding says which.</li>
        <li>We cannot observe the &ldquo;reports to a New York supervisor&rdquo; clause, so we never rely on it.</li>
        <li>We infer four or more employees from five or more open postings. If you know that inference is wrong for a company, tell us.</li>
        <li>A single stated figure satisfies the intent of both laws and we treat it as disclosed.</li>
      </ul>

      <h2>Where to report</h2>
      <p>
        You do not have to be the applicant. The city commission accepts anonymous tips through its online form, and the state Department of Labor says members of
        the public who noticed a posting without a range may report it. A New York City posting can be reported to either agency.
      </p>
      <ul>
        {site.jurisdictions.map((l) => (
          <li key={l.code}>
            <strong>{l.name}</strong>: {l.agency}.{' '}
            {l.complaintUrl ? (
              <a href={l.complaintUrl} target="_blank" rel="noopener noreferrer" className="font-bold underline">
                {l.complaintLabel ?? 'Report'} ↗
              </a>
            ) : null}
          </li>
        ))}
        {site.jurisdictions.length === 0 ? <li>Agency links appear here once the reference data is loaded.</li> : null}
      </ul>
    </article>
  );
}
