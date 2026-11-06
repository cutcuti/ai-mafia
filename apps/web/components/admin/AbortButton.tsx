'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function AbortButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        if (!confirm('Stop this game now? It cannot be resumed.')) return;
        setBusy(true);
        await fetch(`/api/admin/games/${id}/abort`, { method: 'POST' });
        router.refresh();
      }}
      className="rounded-full border border-mafia/60 px-3 py-1 text-sm font-semibold text-mafia hover:bg-mafia/10 disabled:opacity-50"
    >
      {busy ? 'Stopping…' : 'Abort'}
    </button>
  );
}
