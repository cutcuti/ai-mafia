import 'server-only';
import { cookies } from 'next/headers';
import { getSessionUser } from './auth';
import { limitsFromEnv } from './live/types';

/**
 * Guest play: visitors without a GitHub login get a random id in an httpOnly cookie. It is a bearer token
 * (128 random bits), so it only ties a browser to its own human seat; abuse limits are per id AND per IP,
 * because clearing cookies mints a new id.
 */
export const GUEST_COOKIE = 'mafia_guest';
const GUEST_RE = /^guest-[0-9a-f]{32}$/;

export const isGuestId = (v: unknown): v is string => typeof v === 'string' && GUEST_RE.test(v);

export async function readGuestId(): Promise<string | null> {
  const v = (await cookies()).get(GUEST_COOKIE)?.value;
  return isGuestId(v) ? v : null;
}

/** Route handlers only (Server Components can't set cookies). */
export async function ensureGuestId(): Promise<string> {
  const have = await readGuestId();
  if (have) return have;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const id = `guest-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  (await cookies()).set(GUEST_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}

/** Who is looking: the signed-in user's id, else the guest cookie's id (for the human seat view and moves). */
export async function viewerId(): Promise<string | undefined> {
  return (await getSessionUser())?.id ?? (limitsFromEnv().guestsEnabled ? ((await readGuestId()) ?? undefined) : undefined);
}
