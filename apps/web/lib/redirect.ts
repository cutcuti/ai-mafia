/** Only same-site paths: never redirect to another origin after sign-in (open-redirect guard). */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/play';
}
