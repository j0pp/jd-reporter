'use client';

import { Tabs } from '@base-ui/react/tabs';
import * as React from 'react';
import { api, ApiError, getAdminToken, setAdminToken } from '@/lib/api';
import { CompaniesTab } from './CompaniesTab';
import { QueueTab } from './QueueTab';
import { SubmissionsTab } from './SubmissionsTab';

interface Stats {
  findings: Record<string, number>;
  boards: { active: number | null; errors: number | null; total: number };
  companiesNeedingVerification: number;
}

export function AdminApp() {
  const [token, setToken] = React.useState('');
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [ready, setReady] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setStats(await api<Stats>('/api/admin/stats', { admin: true }));
      setError(null);
      setReady(true);
    } catch (e) {
      setReady(false);
      setError(e instanceof ApiError ? (e.status === 401 ? 'token rejected' : e.message) : String(e));
    }
  }, []);

  React.useEffect(() => {
    setToken(getAdminToken());
    void load();
  }, [load]);

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-4 border-rule pb-4">
        <h1 className="text-4xl font-black tracking-tight">Admin</h1>
        <form
          className="flex items-center gap-2 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setAdminToken(token);
            void load();
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="admin token (not needed behind Access)"
            className="block h-10 w-72 px-3 font-mono text-xs"
          />
          <button className="btn py-2 px-3 text-xs" type="submit">
            Use
          </button>
          {error ? <span className="font-bold text-accent">{error}</span> : ready ? <span className="font-bold text-ok">connected</span> : null}
        </form>
      </div>

      {stats ? (
        <div className="mt-6 grid gap-3 md:grid-cols-5">
          {[
            ['queue', stats.findings.needs_review ?? 0],
            ['published', stats.findings.published ?? 0],
            ['rejected', stats.findings.rejected ?? 0],
            ['boards in error', stats.boards.errors ?? 0],
            ['companies to verify', stats.companiesNeedingVerification],
          ].map(([k, v]) => (
            <div key={String(k)} className="block px-4 py-3">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-soft">{k}</div>
              <div className="num text-3xl font-black">{v}</div>
            </div>
          ))}
        </div>
      ) : null}

      {ready ? (
        <Tabs.Root defaultValue="queue" className="mt-8">
          <Tabs.List className="flex gap-2 border-b-4 border-rule">
            {[
              ['queue', 'Review queue'],
              ['submissions', 'Submissions'],
              ['companies', 'Companies'],
            ].map(([v, label]) => (
              <Tabs.Tab
                key={v}
                value={v}
                className="px-5 py-3 text-sm font-extrabold uppercase tracking-wider data-selected:bg-ink data-selected:text-white hover:bg-paper"
              >
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Tabs.Panel value="queue" className="pt-6">
            <QueueTab onChanged={load} />
          </Tabs.Panel>
          <Tabs.Panel value="submissions" className="pt-6">
            <SubmissionsTab />
          </Tabs.Panel>
          <Tabs.Panel value="companies" className="pt-6">
            <CompaniesTab onChanged={load} />
          </Tabs.Panel>
        </Tabs.Root>
      ) : (
        <p className="mt-10 text-ink-soft">Enter the admin token, or open this page through Cloudflare Access.</p>
      )}
    </div>
  );
}
