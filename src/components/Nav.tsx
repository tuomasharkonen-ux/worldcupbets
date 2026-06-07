import Link from 'next/link';
import { getSession } from '@/lib/session';
import { signOut } from '@/app/actions';

export async function Nav() {
  const session = await getSession();
  if (!session.managerId) return null;

  return (
    <nav className="border-b border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-6">
          <span className="font-bold text-white tracking-tight">World Cup Bets</span>
          <Link href="/fixtures" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Fixtures
          </Link>
          <Link href="/leaderboard" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Leaderboard
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">{session.displayName}</span>
          <form action={signOut}>
            <button type="submit" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
