import type { Metadata } from 'next';
import { AdminApp } from '@/components/admin/AdminApp';

export const metadata: Metadata = { title: 'Admin', robots: { index: false, follow: false } };

// a client-only spa behind cloudflare access (or a bearer token in dev); talks to /api/admin/*
export default function AdminPage() {
  return <AdminApp />;
}
