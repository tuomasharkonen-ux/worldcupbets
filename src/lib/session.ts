import { getIronSession, IronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/lib/supabase';

export interface SessionData {
  managerId?: string;
  displayName?: string;
}

// "Stay logged in on this device until further notice." The tournament runs ~6
// weeks, so the session must comfortably outlast it. 400 days is the maximum a
// browser will honor for a persistent cookie (Chrome's cap), and we set iron-session's
// `ttl` to match — without it the sealed token defaults to a 14-day expiry and silently
// logs players out mid-tournament regardless of the cookie's maxAge.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 400; // 400 days

const sessionOptions: SessionOptions = {
  cookieName: 'wcbets_session',
  password: process.env.SESSION_PASSWORD as string,
  ttl: SESSION_TTL_SECONDS,
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS,
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  return getIronSession<SessionData>(cookieStore, sessionOptions);
}

export async function requireManager(): Promise<{ managerId: string; displayName: string }> {
  const session = await getSession();
  if (!session.managerId || !session.displayName) {
    throw new Error('Not authenticated');
  }
  return { managerId: session.managerId, displayName: session.displayName };
}

// Onboarding gate (migration 009): send a manager to /onboarding until they've locked
// in their favorite team + player. Call this right after the auth check at the top of
// every protected page. The /onboarding page itself must NOT call this (it checks auth
// only) or it would redirect-loop.
export async function requireOnboarded(managerId: string): Promise<void> {
  const { data } = await db
    .from('managers')
    .select('onboarding_completed_at')
    .eq('id', managerId)
    .maybeSingle();
  if (!data) redirect('/join'); // row vanished (deleted) — back to square one
  if (!data.onboarding_completed_at) redirect('/onboarding');
}
