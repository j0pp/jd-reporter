'use client';

import { Combobox } from '@base-ui/react/combobox';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { SearchEntry } from '@/lib/data';
import { Logo } from './Logo';

// the whole company index ships as one small json; matching happens in the browser, no server
export function SearchBox({ items, big = false }: { items: SearchEntry[]; big?: boolean }) {
  const router = useRouter();
  const id = React.useId();

  return (
    <Combobox.Root<SearchEntry>
      items={items}
      itemToStringValue={(item) => item.name}
      filter={(item, query) => {
        const q = query.trim().toLowerCase();
        if (!q) return true;
        return item.name.toLowerCase().includes(q) || item.slug.includes(q.replace(/\s+/g, '-'));
      }}
      autoHighlight
      onValueChange={(value) => {
        const v = value as SearchEntry | null;
        if (v) router.push(`/c/${v.slug}`);
      }}
    >
      <div className="relative">
        <label htmlFor={id} className="sr-only">
          Search for a company
        </label>
        <Combobox.InputGroup className={`block flex items-center ${big ? 'h-20' : 'h-14'}`}>
          <Combobox.Input
            id={id}
            placeholder="Search a company…"
            className={`h-full w-full bg-transparent px-5 font-bold outline-none placeholder:text-muted ${big ? 'text-2xl md:text-3xl' : 'text-lg'}`}
          />
          <Combobox.Trigger aria-label="Open list" className="flex h-full w-16 items-center justify-center border-l-4 border-rule text-2xl font-black hover:bg-ink hover:text-white">
            ↓
          </Combobox.Trigger>
        </Combobox.InputGroup>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={8} className="z-50 outline-none">
          <Combobox.Popup className="block w-[var(--anchor-width)] max-w-[var(--available-width)] shadow-[8px_8px_0_#111]">
            <Combobox.Empty className="px-5 py-4 font-semibold text-muted">No company matches. Try the submit form to add one.</Combobox.Empty>
            <Combobox.List className="max-h-[min(24rem,var(--available-height))] overflow-y-auto">
              {(item: SearchEntry) => (
                <Combobox.Item
                  key={item.slug}
                  value={item}
                  className="flex cursor-pointer items-center justify-between gap-4 border-b-2 border-rule/20 px-5 py-4 last:border-b-0 data-highlighted:bg-ink data-highlighted:text-white"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Logo src={item.logo} name={item.name} size={28} />
                    <span className="truncate font-bold">{item.name}</span>
                  </span>
                  <span className="num shrink-0 text-sm font-semibold opacity-70">
                    {item.findings ? `${item.findings} current` : `${item.ny} NY postings`}
                  </span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
