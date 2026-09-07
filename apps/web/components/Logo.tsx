// a company mark in a fixed square so every row lines up. no logo: a monogram tile in the same shape
export function Logo({ src, name, size = 72, className = '' }: { src: string | null | undefined; name: string; size?: number; className?: string }) {
  const style = { width: size, height: size };
  const border = size >= 64 ? 'border-4' : 'border-2';
  if (src) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden ${border} border-rule bg-white ${className}`} style={style}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain p-[8%]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center ${border} border-rule bg-white font-black uppercase tracking-tight text-ink ${className}`}
      style={{ ...style, fontSize: Math.round(size * 0.38) }}
    >
      {monogram(name)}
    </span>
  );
}

export function monogram(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/[\s&/,.-]+/)
    .filter((w) => w && !/^(the|of|and|for|at|inc|llc|co|corp)$/i.test(w));
  const letters = words.slice(0, 2).map((w) => w[0]!);
  return (letters.join('') || name.slice(0, 2)).toUpperCase();
}
