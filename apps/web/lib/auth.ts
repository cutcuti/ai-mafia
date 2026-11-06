import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';
import { devUserMode, fixtureMode } from './devmode';
import type { SessionUser } from './live/types';

export const authConfigured = () => devUserMode() || !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !fixtureMode());

/** Fake signed-in user for offline dev/e2e only (see lib/devmode.ts). */
const DEV_USER: SessionUser = { id: '00000000-0000-4000-8000-00000000d3v0', githubId: 'dev', login: 'local-dev', avatarUrl: null };

/** Supabase client bound to the request's auth cookies (anon key — it can only act as the signed-in user). */
export async function supabaseForRequest() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) jar.set(name, value, options);
        } catch {
          // called from a Server Component: the proxy refreshes cookies instead
        }
      },
    },
  });
}

/** GitHub identity from the provider record (not user_metadata, which users can edit themselves). */
export function toSessionUser(u: User): SessionUser {
  const gh = u.identities?.find((i) => i.provider === 'github');
  const data = (gh?.identity_data ?? {}) as Record<string, unknown>;
  return {
    id: u.id,
    githubId: (data.provider_id as string) ?? (data.sub as string) ?? gh?.id ?? null,
    login: (data.user_name as string) ?? (data.preferred_username as string) ?? null,
    avatarUrl: (data.avatar_url as string) ?? null,
  };
}

/** The signed-in user, verified with Supabase Auth (getUser re-validates the JWT server-side). */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (devUserMode()) return DEV_USER;
  if (!authConfigured()) return null;
  const sb = await supabaseForRequest();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return toSessionUser(data.user);
}

/** Admin = GitHub numeric id listed in ADMIN_GITHUB_IDS (comma-separated). */
export function isAdmin(u: SessionUser | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!u?.githubId) return false;
  const ids = (env.ADMIN_GITHUB_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(u.githubId);
}

/** Client IP for rate limiting (Vercel sets x-forwarded-for; first hop is the client). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
}
