// Builds the Wordle-style, paste-into-chat digest of a manager's slate. Pure (no
// I/O) so it's shared verbatim between the real Today page (server) and the /admin
// preview (client) — the caller supplies a footballer-id → name map.

import { toFlagEmoji } from './country-flags';
import type { Bet, ExactScoreSelection } from '@/types/db';
import { bonusShareText, isBonusBet } from './bonus-bets';

type ShareTeam = { name: string; country_code: string };
type ShareMatch = { id: string; home_team: ShareTeam; away_team: ShareTeam };

// One match per row — `🇧🇷 BRA 2–1 CRO 🇭🇷`, with an inline `⚡×N` when the slip
// carries a stake multiplier — and any player bet on its own line beneath the match.
export function buildSlateShareText(
  matchDay: number,
  members: ShareMatch[],
  betsByMatch: Map<string, Bet[]>,
  playerName: Map<string, string>,
): string {
  const lines: string[] = [`⚽ My bets for Match Day ${matchDay}`, ''];
  for (const m of members) {
    const bs = betsByMatch.get(m.id) ?? [];
    const exact = bs.find(b => b.bet_type === 'exact_score');
    if (!exact) continue; // every slip is core-complete in all-set, but stay safe
    const sel = exact.selection as ExactScoreSelection;

    const homeFlag = toFlagEmoji(m.home_team.name, m.home_team.country_code);
    const awayFlag = toFlagEmoji(m.away_team.name, m.away_team.country_code);
    const home = `${homeFlag ? `${homeFlag} ` : ''}${m.home_team.country_code.toUpperCase()}`;
    const away = `${m.away_team.country_code.toUpperCase()}${awayFlag ? ` ${awayFlag}` : ''}`;

    // One stake/multiplier per slip, shared across its picks (GAME_DESIGN §5).
    const mult = bs[0]?.stake_mult ?? 1;
    const multTag = mult > 1 ? ` ⚡×${mult}` : '';
    lines.push(`${home} ${sel.home}–${sel.away} ${away}${multTag}`);

    const bonus = bs.find(b => isBonusBet(b.bet_type));
    if (bonus) {
      lines.push(
        bonusShareText(bonus, {
          playerName: id => playerName.get(id),
          homeTeam: m.home_team.name,
          awayTeam: m.away_team.name,
        }),
      );
    }
  }
  lines.push('', '🔗 https://worldcupbets.vercel.app');
  return lines.join('\n');
}

// The Golden Bracket digest: the four placements in order, then the top-scorer call.
// Same pure/no-I/O contract as buildSlateShareText so the wizard (client) and the
// /admin preview share one formatter. `teams` is [champion, runner-up, third, fourth];
// any null slot is skipped (defensive — a submitted bracket is always complete).
export function buildGoldenBracketShareText(
  teams: (ShareTeam | null)[],
  scorer: { name: string; goals: number } | null,
): string {
  const slotEmoji = ['🥇', '🥈', '🥉', '4️⃣'];
  const lines: string[] = ['👑 My Golden Bracket', ''];
  teams.forEach((t, i) => {
    if (!t) return;
    const flag = toFlagEmoji(t.name, t.country_code);
    lines.push(`${slotEmoji[i] ?? '•'} ${flag ? `${flag} ` : ''}${t.name}`);
  });
  if (scorer) lines.push('', `⚽ Top scorer: ${scorer.name} (${scorer.goals})`);
  lines.push('', '🔗 https://worldcupbets.vercel.app');
  return lines.join('\n');
}
