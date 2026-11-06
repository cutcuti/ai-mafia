import { listGamesResponse } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return listGamesResponse(getStore(), new URL(req.url));
}
