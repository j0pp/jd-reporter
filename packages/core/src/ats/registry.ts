import type { AtsVendor } from '../types.ts';
import { ashby } from './ashby.ts';
import { greenhouse } from './greenhouse.ts';
import { lever } from './lever.ts';
import type { BoardAdapter, UrlMatch } from './types.ts';
import { isVendorHost } from './types.ts';
import { workday } from './workday.ts';

export const adapters: Record<AtsVendor, BoardAdapter> = { greenhouse, lever, ashby, workday };

export function getAdapter(vendor: string): BoardAdapter {
  const a = adapters[vendor as AtsVendor];
  if (!a) throw new Error(`no adapter for vendor ${vendor}`);
  return a;
}

export function matchAnyAdapter(url: URL): (UrlMatch & { vendor: AtsVendor }) | null {
  for (const a of Object.values(adapters)) {
    const m = a.matchUrl(url);
    if (m) return { ...m, vendor: a.vendor };
  }
  return null;
}

// a posting url on the employer's own domain means the ats json is not the evidence surface
export function isOffsite(vendor: AtsVendor, url: string): boolean {
  if (!url) return false;
  return !isVendorHost(adapters[vendor], url);
}
