import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { SearchBox } from '@/components/SearchBox';
import { StatTile } from '@/components/StatTile';
import { getLeaderboard, getSearchIndex, getSite } from '@/lib/data';
import { fmtInt, pct } from '@/lib/format';

export default function Home() {
  const site = getSite();
  const leaderboard = getLeaderboard();
  const index = getSearchIndex();
  const s = site.stats;

  return (
    <>
      <section className="py-12 md:py-16">
        <h1 className="max-w-5xl text-5xl font-black leading-[0.95] tracking-tight md:text-7xl">
          New York job postings that did not include a pay range.
        </h1>
        <p className="mt-6 max-w-3xl text-xl leading-relaxed text-ink-soft">
          Read every day from each employer&apos;s own job board, then approved by a person before it appears here. When a range shows up,
          the entry disappears the next morning.
        </p>
        <div className="mt-10 max-w-3xl">
          <SearchBox items={index} big />
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-4">
        <StatTile label="Companies checked" value={fmtInt(s.companiesChecked)} />
        <StatTile label="NY postings read" value={fmtInt(s.postingsNy)} sub="open right now, any of their boards" />
        <StatTile label="Disclosed a range" value={pct(s.disclosedNy, s.postingsNy)} sub={`${fmtInt(s.disclosedNy)} of ${fmtInt(s.postingsNy)}`} />
        <StatTile label="Current findings" value={fmtInt(s.currentFindings)} sub={`${fmtInt(s.companiesOnLeaderboard)} companies with 2 or more`} accent />
      </section>

      <section id="leaderboard" className="mt-20">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b-4 border-rule pb-4">
          <h2 className="text-3xl font-black tracking-tight md:text-5xl">Most postings without a range, today</h2>
          <p className="max-w-md text-sm font-semibold text-ink-soft">
            Employers with 5+ open postings and at least two current findings. The count sits next to how many New York postings they have, because a
            one-off template mistake at a company with 300 postings is not the same story as 15 of 66.
          </p>
        </div>
        {leaderboard.length === 0 ? (
          <div className="block mt-8 p-10 text-center">
            <p className="text-2xl font-black">Nothing published yet.</p>
            <p className="mt-2 text-ink-soft">Findings appear only after a human has reviewed them.</p>
          </div>
        ) : (
          <ol className="mt-8 block divide-y-4 divide-rule">
            {leaderboard.map((c, i) => (
              <li key={c.slug} className="grid items-center gap-4 px-6 py-5 md:grid-cols-[4rem_4.5rem_1fr_10rem_12rem] md:py-6">
                <span className="num text-3xl font-black text-muted md:text-4xl">{i + 1}</span>
                <Logo src={c.logo} name={c.displayName} size={72} />
                <div>
                  <Link href={`/c/${c.slug}`} className="text-2xl font-black leading-tight hover:text-accent md:text-3xl">
                    {c.displayName}
                  </Link>
                </div>
                <div className="num text-5xl font-black leading-none md:text-6xl">{c.currentFindings}</div>
                <div className="text-sm font-bold text-ink-soft">
                  of <span className="num">{c.openPostingsNy}</span> NY postings
                  <br />
                  <span className="num">{pct(c.disclosedNy, c.openPostingsNy)}</span> disclosed
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-20 grid gap-6 md:grid-cols-3">
        <Link href="/methodology" className="block p-8 hover:bg-ink hover:text-white">
          <div className="text-xs font-extrabold uppercase tracking-[0.2em]">How this works</div>
          <div className="mt-3 text-2xl font-black">Boards, not aggregators. Twice, then a person.</div>
        </Link>
        <Link href="/law" className="block p-8 hover:bg-ink hover:text-white">
          <div className="text-xs font-extrabold uppercase tracking-[0.2em]">The two laws</div>
          <div className="mt-3 text-2xl font-black">What NYC and New York State actually require.</div>
        </Link>
        <Link href="/submit" className="block bg-accent p-8 text-white hover:bg-ink">
          <div className="text-xs font-extrabold uppercase tracking-[0.2em]">Seen one?</div>
          <div className="mt-3 text-2xl font-black">Paste a posting or a job board and we will check it.</div>
        </Link>
      </section>
    </>
  );
}
