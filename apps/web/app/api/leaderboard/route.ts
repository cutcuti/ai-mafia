import { leaderboardResponse } from '@/lib/api';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return leaderboardResponse(getStore(), new URL(req.url));
}
