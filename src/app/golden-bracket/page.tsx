import { redirect } from 'next/navigation';
import { getSession, requireOnboarded } from '@/lib/session';
import { db } from '@/lib/supabase';
import {
  getGbTeams,
  getGoldenBracketWindow,
  getMyBracket,
  getScorerBoard,
} from '@/lib/golden-bracket';
import { Nav } from '@/components/Nav';
import type { League } from '@/types/db';
import type { GoldenBracketPayload } from './actions';
import { GoldenBracketFlow } from './GoldenBracketFlow';

// The Golden Bracket wizard (migration 016). Reachable only while the feature is
// live: config present and the QF field known. Launched from the Today promo — no
// nav entry, this is a one-time flow.
export default async function GoldenBracketPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const session = await getSession();
  if (!session.managerId) redirect('/join');
  await requireOnboarded(session.managerId);

  const { data: league } = await db
    .from('league')
    .select('config')
    .eq('id', 1)
    .single<Pick<League, 'config'>>();
  const cfg = league?.config.golden_bracket;
  if (!cfg) redirect('/today');

  const window = await getGoldenBracketWindow();
  if (!window) redirect('/today');

  const [teams, scorers, mine, { error }] = await Promise.all([
    getGbTeams(window, cfg),
    getScorerBoard(window),
    getMyBracket(session.managerId),
    searchParams,
  ]);
  if (!teams) redirect('/today'); // odds not seeded for a QF team — loader logged it

  const myPick: GoldenBracketPayload | null = mine
    ? {
        champion: mine.champion_team_id,
        runnerUp: mine.runner_up_team_id,
        third: mine.third_team_id,
        fourth: mine.fourth_team_id,
        scorerId: mine.top_scorer_id,
        scorerGoals: mine.scorer_goals,
      }
    : null;

  const now = new Date();
  const locked = now >= new Date(window.lockAt);

  return (
    <>
      <Nav />
      <main className="mx-auto w-full max-w-lg space-y-5 px-4 py-8">
        <GoldenBracketFlow
          teams={teams}
          scorers={scorers}
          cfg={cfg}
          myPick={myPick}
          lockAt={window.lockAt}
          locked={locked}
          error={error ?? null}
        />
      </main>
    </>
  );
}
