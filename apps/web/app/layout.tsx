import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Footer, Nav } from '@/components/Nav';
import { getSite } from '@/lib/data';
import { SITE_ORIGIN } from '@/lib/site';
import './globals.css';

const TITLE = 'JD Reporter: New York job postings without a pay range';
const DESCRIPTION =
  'A public ledger of New York job postings that did not include a pay range, read from each employer’s own job board and re-checked daily.';

// metadataBase is what makes any relative metadata absolute; without it next emits relative og urls and the
// pages get cited by whatever host happened to serve them. nothing url-shaped is set here on purpose: a
// canonical or og:url in the root layout is inherited by every page, which would point the whole site at /
export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { type: 'website', siteName: 'JD Reporter', title: TITLE, description: DESCRIPTION },
  twitter: { card: 'summary', title: TITLE, description: DESCRIPTION },
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
