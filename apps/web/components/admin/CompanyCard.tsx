'use client';

import * as React from 'react';
import { API_BASE, api, getAdminToken } from '@/lib/api';
import { Logo } from '../Logo';
import { SECTORS, type AdminCompany } from './types';

// the stored logo through the admin blob route (needs the bearer token, so it is fetched into an object url)
function AdminLogo({ company }: { company: AdminCompany }) {
  const [src, setSrc] = React.useState<string | null>(null);
  React.useEffect(() => {
    let url: string | null = null;
    setSrc(null);
    if (!company.logoKey) return;
    const headers = new Headers();
    const t = getAdminToken();
    if (t) headers.set('authorization', `Bearer ${t}`);
    fetch(`${API_BASE}/api/admin/blob?key=${encodeURIComponent(company.logoKey)}`, { headers, credentials: 'include' })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b) {
          url = URL.createObjectURL(b);
          setSrc(url);
        }
      })
      .catch(() => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [company.logoKey]);
  return <Logo src={src} name={company.displayName} size={44} />;
}

// the verify card: a finding cannot publish until a person confirmed the name and sector (the nyuhs lesson)
export function CompanyCard({ company, onSaved, compact = false }: { company: AdminCompany; onSaved: (c: AdminCompany) => void; compact?: boolean }) {
  const [name, setName] = React.useState(company.displayName);
  const [sector, setSector] = React.useState(company.sector ?? '');
  const [hqCity, setHqCity] = React.useState(company.hqCity ?? '');
  const [hqState, setHqState] = React.useState(company.hqState ?? '');
  const [staffing, setStaffing] = React.useState(company.isStaffingFirm);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    setName(company.displayName);
    setSector(company.sector ?? '');
    setHqCity(company.hqCity ?? '');
    setHqState(company.hqState ?? '');
    setStaffing(company.isStaffingFirm);
    setMsg(null);
  }, [company]);

  async function save(verify?: boolean) {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await api<AdminCompany>(`/api/admin/companies/${company.id}`, {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ displayName: name, sector: sector || null, hqCity: hqCity || null, hqState: hqState || null, isStaffingFirm: staffing, ...(verify === undefined ? {} : { verify }) }),
      });
      onSaved({ ...updated, boards: company.boards });
      setMsg(verify ? 'verified' : 'saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`block-soft p-4 ${compact ? '' : 'md:p-6'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-ink-soft">
          Company · {company.openPostingsTotal} open postings · {company.openPostingsNy} NY · {company.inCohort ? 'in cohort' : 'NOT scored (<5 postings)'}
          {company.enrichment?.nameSource ? ` · name from ${company.enrichment.nameSource.replace(/_/g, ' ')}` : ' · name guessed from slug'}
        </div>
        <div className={`tag ${company.verifiedAt ? 'bg-ok border-ok text-white' : 'tag-accent'}`}>{company.verifiedAt ? 'verified' : 'unverified'}</div>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-[3rem_2fr_1fr_1fr_4rem]">
        <AdminLogo company={company} />
        <input value={name} onChange={(e) => setName(e.target.value)} className="block h-11 px-3 text-lg font-black" aria-label="Display name" />
        <select value={sector} onChange={(e) => setSector(e.target.value)} className="block h-11 px-2 font-bold" aria-label="Sector">
          <option value="">sector…</option>
          {SECTORS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input value={hqCity} onChange={(e) => setHqCity(e.target.value)} placeholder="HQ city" className="block h-11 px-3 font-bold" aria-label="HQ city" />
        <input value={hqState} onChange={(e) => setHqState(e.target.value)} placeholder="ST" className="block h-11 px-3 font-bold" aria-label="HQ state" maxLength={2} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2 font-bold">
          <input type="checkbox" checked={staffing} onChange={(e) => setStaffing(e.target.checked)} /> staffing / recruiting firm (exempt)
        </label>
        <span className="flex-1" />
        <button className="btn btn-ghost py-2 px-3 text-xs" disabled={busy} onClick={() => save()}>
          Save
        </button>
        {company.verifiedAt ? (
          <button className="btn btn-ghost py-2 px-3 text-xs" disabled={busy} onClick={() => save(false)}>
            Unverify
          </button>
        ) : (
          <button className="btn py-2 px-3 text-xs" disabled={busy} onClick={() => save(true)}>
            Save + Verify (V)
          </button>
        )}
        {msg ? <span className="font-bold text-ink-soft">{msg}</span> : null}
      </div>
      {company.boards?.length ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-ink-soft">
          {company.boards.map((b) => (
            <span key={b.id} className="tag">
              {b.vendor}:{b.slug} · {b.status} · {b.openPostingsTotal}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
