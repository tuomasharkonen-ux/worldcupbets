import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import type { Manager } from '@/types/db';

export default async function LeaderboardPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');

  const { data: managers } = await db
    .from('managers')
    .select('id, display_name, glory, coins')
    .order('glory', { ascending: false });

  const rows = (managers ?? []) as Pick<Manager, 'id' | 'display_name' | 'glory' | 'coins'>[];

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-xl font-semibold text-white mb-6">Leaderboard</h1>

        {rows.length === 0 ? (
          <p className="text-zinc-500 text-sm">No managers have joined yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 bg-zinc-900">
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-zinc-400 w-8">#</th>
                  <th className="py-2.5 px-4 text-left text-xs font-medium text-zinc-400">Manager</th>
                  <th className="py-2.5 px-4 text-right text-xs font-medium text-zinc-400">Glory</th>
                  <th className="py-2.5 px-4 text-right text-xs font-medium text-zinc-400">Coins</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr
                    key={m.id}
                    className={`border-b border-zinc-800 last:border-0 ${
                      m.id === session.managerId ? 'bg-indigo-950/30' : 'bg-zinc-950'
                    }`}
                  >
                    <td className="py-3 px-4 text-zinc-500">{i + 1}</td>
                    <td className="py-3 px-4 font-medium text-white">
                      {m.display_name}
                      {m.id === session.managerId && (
                        <span className="ml-2 text-xs text-indigo-400">you</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-amber-400">{m.glory} GP</td>
                    <td className="py-3 px-4 text-right font-mono text-zinc-300">{m.coins} ¢</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
