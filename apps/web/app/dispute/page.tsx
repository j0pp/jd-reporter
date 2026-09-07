import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dispute an entry' };

const EMAIL = process.env.NEXT_PUBLIC_DISPUTE_EMAIL ?? 'dispute@example.org';

export default function Dispute() {
  return (
    <article className="prose-block max-w-3xl py-12 text-lg leading-relaxed">
      <h1 className="text-5xl font-black leading-[0.95] tracking-tight md:text-6xl">Dispute an entry</h1>
      <p className="mt-6 text-ink-soft">
        You have the strongest incentive to find our mistakes, and we want them found. Two business days, logged, no arguing.
      </p>

      <h2>If a posting on this site has a pay range</h2>
      <p>
        Tell us where. If it is on the page we read, we were wrong and the entry comes down the same day with a note explaining the miss, which becomes a
        test so it does not happen again. If it was added after we read it, the entry will already be marked fixed on the next crawl; write anyway if you want it
        gone sooner.
      </p>

      <h2>If the job is not performed in New York</h2>
      <p>The posting listed a New York location when we read it. If that was a mistake on the posting, fix the posting and the entry drops off. If we misread the location, tell us.</p>

      <h2>If you have fewer than four employees, or you are a staffing firm</h2>
      <p>Say so. We infer size from open postings and we will take your word for it, mark the company as not scored, and note the dispute.</p>

      <h2>If the company name is wrong</h2>
      <p>Slugs are not names. We verify the display name before publishing, but if we got it wrong, we will fix it and redirect the old page.</p>

      <div className="block mt-10 p-8">
        <div className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">Write to</div>
        <a href={`mailto:${EMAIL}`} className="mt-2 block text-3xl font-black break-all hover:text-accent">
          {EMAIL}
        </a>
        <p className="mt-4 text-sm text-ink-soft">Include the page URL from this site and, if you have it, the posting URL. We reply within two business days.</p>
      </div>
    </article>
  );
}
