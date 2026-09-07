'use client';

// same origin in production (the worker serves both); NEXT_PUBLIC_API_BASE points at wrangler dev locally
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const TOKEN_KEY = 'jdr_admin_token';

export function getAdminToken(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(t: string) {
  window.localStorage.setItem(TOKEN_KEY, t);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit & { admin?: boolean }): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (init?.admin) {
    const t = getAdminToken();
    if (t) headers.set('authorization', `Bearer ${t}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `http ${res.status}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

// blobs come back gzip-encoded; the browser inflates them and we parse here, so the worker spends no cpu
export async function fetchBlob(key: string): Promise<unknown> {
  const headers = new Headers();
  const t = getAdminToken();
  if (t) headers.set('authorization', `Bearer ${t}`);
  const res = await fetch(`${API_BASE}/api/admin/blob?key=${encodeURIComponent(key)}`, { headers, credentials: 'include' });
  if (!res.ok) throw new ApiError(res.status, `blob ${res.status}`);
  const text = await res.text();
  if (key.endsWith('.html.gz')) return text;
  return JSON.parse(text);
}
