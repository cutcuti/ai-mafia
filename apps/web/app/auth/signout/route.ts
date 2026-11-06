import { NextResponse } from 'next/server';
import { authConfigured, supabaseForRequest } from '@/lib/auth';

export async function POST(req: Request) {
  if (authConfigured()) await (await supabaseForRequest()).auth.signOut();
  return NextResponse.redirect(new URL('/', req.url), { status: 303 });
}
