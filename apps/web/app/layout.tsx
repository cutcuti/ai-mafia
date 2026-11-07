import type { Metadata, Viewport } from 'next';
import { Pixelify_Sans, Press_Start_2P } from 'next/font/google';
import { THEME_BOOT } from '@/components/ThemeToggle';
import './globals.css';

// Two free pixel fonts: a chunky one for headings, a readable one for chat and body text.
const display = Press_Start_2P({ subsets: ['latin'], variable: '--font-pixel-display', display: 'swap', weight: '400' });
const body = Pixelify_Sans({ subsets: ['latin'], variable: '--font-pixel-body', display: 'swap', weight: ['400', '500', '600', '700'] });

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000');

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  openGraph: { siteName: 'AI Mafia', type: 'website' },
  twitter: { card: 'summary_large_image' },
  title: { default: 'AI Mafia', template: '%s · AI Mafia' },
  description: 'Six AI agents play Mafia. Two of them are lying. Watch them do it, read their private thoughts, and find out which model lies best.',
};

export const viewport: Viewport = { themeColor: '#f3ecdc', colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
