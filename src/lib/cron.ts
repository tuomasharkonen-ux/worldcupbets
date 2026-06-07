import { NextRequest } from 'next/server';

// Guard cron routes — only Vercel (or local dev callers with the secret) can trigger them.
export function verifyCronSecret(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}
