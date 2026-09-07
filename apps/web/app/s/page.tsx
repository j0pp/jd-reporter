import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StatusView } from '@/components/StatusView';

export const metadata: Metadata = { title: 'Submission status', robots: { index: false } };

// static shell; the token lives in ?t= so the export needs no dynamic segment
export default function StatusPage() {
  return (
    <section className="py-12">
      <h1 className="text-4xl font-black tracking-tight md:text-6xl">Your submission</h1>
      <div className="mt-8 max-w-4xl">
        <Suspense fallback={<p className="text-ink-soft">Loading…</p>}>
          <StatusView />
        </Suspense>
      </div>
    </section>
  );
}
