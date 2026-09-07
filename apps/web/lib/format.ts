export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return 'not yet';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return 'not yet';
  const d = new Date(iso);
  return `${d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/New_York' })} ET`;
}

export function pct(n: number, d: number): string {
  if (!d) return '–';
  return `${Math.round((100 * n) / d)}%`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

export const FINDING_LABEL: Record<string, string> = {
  missing_range: 'No pay range',
  open_ended_range: 'One-sided range',
  placeholder_range: 'Unfilled template',
};

// 18 buckets, each roughly a naics 2-digit code. only the admin verify card uses this today: nothing fills
// sector automatically and the public pages do not show it until something trustworthy does
export const SECTOR_LABEL: Record<string, string> = {
  software: 'Software & internet',
  ai: 'AI',
  fintech_finance: 'Finance & fintech',
  crypto: 'Crypto & prediction markets',
  healthcare: 'Healthcare providers & payers',
  biotech_pharma: 'Biotech & pharma',
  retail: 'Retail',
  hospitality_food: 'Hospitality & food',
  media_advertising: 'Media & advertising',
  education: 'Education',
  government_public: 'Government & contractors',
  nonprofit_social_services: 'Nonprofit & social services',
  real_estate_proptech: 'Real estate & proptech',
  professional_services: 'Professional services',
  logistics_delivery: 'Logistics & delivery',
  staffing: 'Staffing & recruiting',
  industrial_construction: 'Industrial & construction',
  consumer_goods: 'Consumer goods & fashion',
};

export const SECTORS = Object.keys(SECTOR_LABEL);
