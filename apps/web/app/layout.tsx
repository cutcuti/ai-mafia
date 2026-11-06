import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Geist } from 'next/font/google';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist', display: 'swap' });
const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage', display: 'swap', weight: ['600', '800'] });

export const metadata: Metadata = {
  title: { default: 'AI Mafia', template: '%s · AI Mafia' },
  description: 'Six AI agents play Mafia. Two of them are lying. Watch them do it, read their private thoughts, and find out which model lies best.',
};

export const viewport: Viewport = { themeColor: '#0b0a12', colorScheme: 'dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${bricolage.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
