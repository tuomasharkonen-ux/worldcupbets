import { getIronSession, IronSession, SessionOptions } from 'iron-session';
import { cookies } from 'next/headers';

export interface SessionData {
  managerId?: string;
  displayName?: string;
}

const sessionOptions: SessionOptions = {
  cookieName: 'wcbets_session',
  password: process.env.SESSION_PASSWORD as string,
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30, // 30 days
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
