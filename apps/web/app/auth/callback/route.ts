import { NextResponse } from 'next/server';
import { supabaseForRequest } from '@/lib/auth';
import { safeNext } from '@/lib/redirect';

/** GitHub → Supabase → here with ?code: exchange it for a session cookie, then go back where the user was. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = safeNext(url.searchParams.get('next'));
  if (code) {
    const sb = await supabaseForRequest();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/play?auth=failed', url.origin));
}
