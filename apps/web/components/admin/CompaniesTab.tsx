'use client';

import * as React from 'react';
import { api } from '@/lib/api';
import { CompanyCard } from './CompanyCard';
import type { AdminCompany } from './types';

export function CompaniesTab({ onChanged }: { onChanged: () => void }) {
  const [q, setQ] = React.useState('');
  const [filter, setFilter] = React.useState<'unverified' | 'all'>('unverified');
  const [rows, setRows] = React.useState<AdminCompany[]>([]);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    setBusy(true);
    try {
      setRows(await api<AdminCompany[]>(`/api/admin/companies?filter=${filter}&q=${encodeURIComponent(q)}`, { admin: true }));
    } finally {
      setBusy(false);
    }
  }, [q, filter]);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="search name or slug" className="block h-12 w-80 px-4 font-bold" />
        <select value={filter} onChange={(e) => setFilter(e.target.value as 'unverified' | 'all')} className="block h-12 px-3 font-bold">
          <option value="unverified">unverified only</option>
          <option value="all">all active</option>
        </select>
        <span className="text-sm font-bold text-ink-soft">{busy ? 'loading…' : `${rows.length} companies`}</span>
      </div>
      <div className="space-y-3">
        {rows.map((c) => (
          <CompanyCard
            key={c.id}
            company={c}
            compact
            onSaved={(u) => {
              setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, ...u } : r)));
              onChanged();
            }}
          />
        ))}
      </div>
    </div>
  );
}
