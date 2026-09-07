import Link from 'next/link';

export function Placeholder({ what }: { what: string }) {
  return (
    <section className="block my-16 p-10 text-center">
      <p className="text-3xl font-black">{what}</p>
      <p className="mt-3 text-ink-soft">This page exists so the site builds before the first crawl. It will be replaced by real content.</p>
      <Link href="/" className="btn mt-8 text-xs">
        Back to the leaderboard
      </Link>
    </section>
  );
}
