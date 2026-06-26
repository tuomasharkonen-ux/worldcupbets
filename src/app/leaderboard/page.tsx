import { redirect } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { Trophy, Crown, Medal, Coins, Sparkles } from 'lucide-react';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import { Nav } from '@/components/Nav';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import type { Manager } from '@/types/db';

const MEDAL = [
  { Icon: Crown, color: 'text-points' }, // 1st
  { Icon: Medal, color: 'text-[#cbd5e1]' }, // 2nd — silver
  { Icon: Medal, color: 'text-[#d9883e]' }, // 3rd — bronze
];

/** Surname only — keeps the favourite-player tag short on narrow screens. */
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts[parts.length - 1] || full;
}

type LeaderboardRow = Pick<
  Manager,
  'id' | 'display_name' | 'glory' | 'coins' | 'favorite_team_id' | 'favorite_footballer_id'
>;

// The standings are the same for everyone (only the "you" highlight is per-viewer,
// derived from the session), so cache the read and share it across requests. On a
// post-result rush this collapses many full-table reads into roughly one per minute.
// A minute of staleness is fine here — the authoritative recap lives on /today.
const getLeaderboardData = unstable_cache(
  async () => {
    const { data: managers } = await db
      .from('managers')
      .select('id, display_name, glory, coins, favorite_team_id, favorite_footballer_id')
      .order('glory', { ascending: false });
    const rows = (managers ?? []) as LeaderboardRow[];

    // Batch-resolve the favourite team + player for every row (avoids an N+1 per manager).
    const teamIds = [...new Set(rows.map(r => r.favorite_team_id).filter(Boolean))] as string[];
    const playerIds = [...new Set(rows.map(r => r.favorite_footballer_id).filter(Boolean))] as string[];

    const [{ data: teams }, { data: players }] = await Promise.all([
      teamIds.length
        ? db.from('teams').select('id, name, country_code').in('id', teamIds)
        : Promise.resolve({ data: [] }),
      playerIds.length
        ? db.from('footballers').select('id, name').in('id', playerIds)
        : Promise.resolve({ data: [] }),
    ]);

    return {
      rows,
      teams: (teams ?? []) as { id: string; name: string; country_code: string }[],
      players: (players ?? []) as { id: string; name: string }[],
    };
  },
  ['leaderboard-standings'],
  { revalidate: 60, tags: ['managers'] },
);

export default async function LeaderboardPage() {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);

  const { rows, teams, players } = await getLeaderboardData();
  const teamById = new Map(teams.map(t => [t.id, t]));
  const playerById = new Map(players.map(p => [p.id, p]));

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Trophy className="size-7 text-points" aria-hidden />
          <h1 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Leaderboard
          </h1>
        </div>

        {rows.length === 0 ? (
          <Card className="text-center text-sm text-muted">No managers have joined yet.</Card>
        ) : (
          <Card variant="glass" padding="sm">
            <ul className="space-y-1.5">
              {rows.map((m, i) => {
                const isYou = m.id === session.managerId;
                const medal = MEDAL[i];
                const team = m.favorite_team_id ? teamById.get(m.favorite_team_id) : null;
                const player = m.favorite_footballer_id
                  ? playerById.get(m.favorite_footballer_id)
                  : null;
                const hasFavorites = team || player;
                return (
                  <li
                    key={m.id}
                    className={`flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 transition-colors ${
                      isYou
                        ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_16%,transparent)] ring-1 ring-[var(--color-primary-bright)]/40'
                        : 'bg-surface-2/60'
                    }`}
                  >
                    <span className="grid w-7 shrink-0 place-items-center">
                      {medal ? (
                        <medal.Icon className={`size-6 ${medal.color}`} aria-label={`Rank ${i + 1}`} />
                      ) : (
                        <span className="font-mono text-sm font-semibold text-subtle">{i + 1}</span>
                      )}
                    </span>

                    {/* Name + subtle favourites — gets the lion's share of the row width. */}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-display font-semibold text-foreground">
                          {m.display_name}
                        </span>
                        {isYou && (
                          <Badge variant="primary" size="sm" className="shrink-0">
                            you
                          </Badge>
                        )}
                      </div>
                      {hasFavorites && (
                        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-subtle">
                          {team && (
                            <Flag
                              name={team.name}
                              countryCode={team.country_code}
                              size="sm"
                              className="shrink-0"
                            />
                          )}
                          {player && <span className="truncate">{lastName(player.name)}</span>}
                        </div>
                      )}
                    </div>

                    {/* Points lead; credits sit underneath, deliberately smaller. */}
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="flex items-center gap-1 font-mono tabular-nums text-points">
                        <Sparkles className="size-4" aria-hidden />
                        <span className="text-lg font-bold leading-none">{m.glory}</span>
                        <span className="text-[0.7rem] text-points/70">pts</span>
                      </span>
                      <span className="flex items-center gap-1 font-mono text-[0.7rem] tabular-nums text-muted/80">
                        <Coins className="size-3" aria-hidden />
                        {m.coins}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </main>
    </>
  );
}
