import { renderSiteCard } from '@/lib/og-render';

export const alt = 'AI Mafia: six AIs play Mafia, two of them are lying.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return renderSiteCard();
}
