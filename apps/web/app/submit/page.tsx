import type { Metadata } from 'next';
import { SubmitForm } from '@/components/SubmitForm';

export const metadata: Metadata = { title: 'Submit a posting or a job board' };

export default function SubmitPage() {
  return (
    <section className="py-12">
      <h1 className="max-w-4xl text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">Seen a New York posting with no pay range?</h1>
      <p className="mt-6 max-w-3xl text-xl leading-relaxed text-ink-soft">
        Paste the posting, or the employer&apos;s whole job board, and we will read it ourselves. You get a quick answer now and a status page you can come back to.
        Nothing you submit is published until a person has looked.
      </p>
      <div className="mt-10 max-w-4xl">
        <SubmitForm />
      </div>
      <div className="mt-12 grid max-w-4xl gap-6 md:grid-cols-3 text-sm">
        <div className="block p-5">
          <div className="font-black">Works</div>
          <p className="mt-2 text-ink-soft">Greenhouse, Lever, Ashby and Workday links, or an employer&apos;s own careers page that uses one of them.</p>
        </div>
        <div className="block p-5">
          <div className="font-black">Does not work</div>
          <p className="mt-2 text-ink-soft">LinkedIn, Indeed, Glassdoor and other aggregators. Open the job there, click Apply, paste the employer page instead.</p>
        </div>
        <div className="block p-5">
          <div className="font-black">Out of scope</div>
          <p className="mt-2 text-ink-soft">Postings with no New York location. Remote postings until we know the company&apos;s HQ. Staffing agencies.</p>
        </div>
      </div>
    </section>
  );
}
