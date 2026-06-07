import type { Metadata } from 'next';
import { Fredoka, Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import 'flag-icons/css/flag-icons.min.css';
import './globals.css';

// Display — rounded & bubbly, for headings and the wordmark
const fredoka = Fredoka({
  subsets: ['latin'],
  variable: '--font-fredoka',
  weight: ['400', '500', '600', '700'],
});

// Body / UI — friendly, highly legible
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
});

// Mono — scores & numeric, tabular
const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
});

export const metadata: Metadata = {
  title: 'World Cup Bets',
  description: 'Five-player World Cup betting league',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${fredoka.variable} ${jakarta.variable} ${geistMono.variable}`}
    >
      <body className="min-h-full bg-background text-foreground">{children}</body>
    </html>
  );
}
