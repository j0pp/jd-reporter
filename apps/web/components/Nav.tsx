import Link from 'next/link';

export function Nav() {
  return (
    <header className="border-b-4 border-rule bg-paper">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-6 py-5">
        <Link href="/" className="text-2xl font-black tracking-tight uppercase">
          JD Reporter
        </Link>
        <nav className="flex items-center gap-6 text-sm font-extrabold uppercase tracking-wider">
          <Link href="/#leaderboard" className="hover:text-accent">
            Leaderboard
          </Link>
          <Link href="/methodology" className="hover:text-accent">
            Method
          </Link>
          <Link href="/law" className="hover:text-accent">
            The law
          </Link>
          <Link href="/dispute" className="hover:text-accent">
            Dispute
          </Link>
          <Link href="/submit" className="btn py-2 px-4 text-xs">
            Submit a posting
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Footer({ asOf }: { asOf: string | null }) {
  return (
    <footer className="mt-24 border-t-4 border-rule">
      <div className="mx-auto max-w-[1400px] px-6 py-10 text-sm text-ink-soft">
        <p className="max-w-3xl">
          Every statement on this site is an observation about a public web page on a given date, made by reading the employer&apos;s own job board and kept
          with a copy of what we read. We say what a posting did or did not contain. We do not say anyone broke a law. Employers can{' '}
          <a href="/dispute" className="underline font-bold">
            dispute any entry
          </a>
          .
        </p>
        <p className="mt-4">
          Last crawl {asOf ? new Date(asOf).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' }) + ' ET' : 'not yet'}.
          Data is CC BY:{' '}
          <a href="/data/findings.csv" className="underline">
            download the findings csv
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
