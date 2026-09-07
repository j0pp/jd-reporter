export function StatTile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`block p-6 md:p-8 ${accent ? 'bg-ink text-white' : ''}`}>
      <div className="text-xs font-extrabold uppercase tracking-[0.2em] opacity-80">{label}</div>
      <div className="num mt-3 text-5xl font-black leading-none md:text-7xl">{value}</div>
      {sub ? <div className="mt-3 text-sm font-semibold opacity-80">{sub}</div> : null}
    </div>
  );
}
