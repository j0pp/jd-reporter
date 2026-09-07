'use client';

import { useRouter } from 'next/navigation';
import * as React from 'react';
import { api, ApiError } from '@/lib/api';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

interface SubmitResponse {
  token: string;
  status: string;
  message?: string;
  hint?: string;
  quick?: Record<string, unknown> | null;
}

export function SubmitForm() {
  const router = useRouter();
  const [url, setUrl] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [rejected, setRejected] = React.useState<SubmitResponse | null>(null);

  React.useEffect(() => {
    if (!SITE_KEY || document.querySelector('script[data-turnstile]')) return;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    s.async = true;
    s.dataset.turnstile = '1';
    document.head.appendChild(s);
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setRejected(null);
    try {
      const form = new FormData(e.currentTarget);
      const turnstileToken = String(form.get('cf-turnstile-response') ?? '');
      const r = await api<SubmitResponse>('/api/submit', { method: 'POST', body: JSON.stringify({ url, note, turnstileToken }) });
      if (r.status === 'rejected') {
        setRejected(r);
        return;
      }
      router.push(`/s?t=${encodeURIComponent(r.token)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'something went wrong; try again');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <label className="block">
        <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">Posting or job board url</span>
        <input
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://boards.greenhouse.io/… or the employer's careers page"
          className="block mt-2 h-20 w-full px-5 text-xl font-bold outline-none focus:border-accent md:text-2xl"
        />
      </label>
      <label className="block">
        <span className="text-xs font-extrabold uppercase tracking-[0.2em] text-ink-soft">Note (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="anything we should know" className="block mt-2 h-24 w-full p-4 text-lg outline-none focus:border-accent" />
      </label>
      {SITE_KEY ? <div className="cf-turnstile" data-sitekey={SITE_KEY} data-theme="light" /> : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy} className="btn text-base disabled:opacity-50">
          {busy ? 'Checking…' : 'Check it'}
        </button>
        {error ? <span className="font-bold text-accent">{error}</span> : null}
      </div>
      {rejected ? (
        <div className="block-soft border-warn p-6">
          <p className="text-xl font-black">We can&apos;t use that link.</p>
          <p className="mt-2 text-ink-soft">
            {rejected.message === 'aggregator'
              ? 'That is a job aggregator. Aggregators often lose the pay range when they copy a posting, so they are not evidence of anything. Open the job there, click Apply, and paste the URL of the employer\u2019s own page.'
              : 'We could not tell what that page is. Paste a job posting or careers page on the employer\u2019s own site, or a Greenhouse, Lever, Ashby or Workday link.'}
          </p>
        </div>
      ) : null}
    </form>
  );
}
