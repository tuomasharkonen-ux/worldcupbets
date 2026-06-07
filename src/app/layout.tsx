import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'World Cup Bets',
  description: 'Five-player World Cup betting league',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full bg-zinc-950 text-zinc-100">{children}</body>
    </html>
  );
}
