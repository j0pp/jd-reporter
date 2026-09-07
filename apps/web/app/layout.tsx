import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Footer, Nav } from '@/components/Nav';
import { getSite } from '@/lib/data';
import './globals.css';

export const metadata: Metadata = {
  title: 'JD Reporter: New York job postings without a pay range',
  description: 'A public ledger of New York job postings that did not include a pay range, read from each employer\u2019s own job board and re-checked daily.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const site = getSite();
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Nav />
        <main className="mx-auto max-w-[1400px] px-6">{children}</main>
        <Footer asOf={site.lastCrawlAt} />
      </body>
    </html>
  );
}
