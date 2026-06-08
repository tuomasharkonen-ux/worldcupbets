// Builds the Wordle-style, paste-into-chat digest of a manager's slate. Pure (no
// I/O) so it's shared verbatim between the real Today page (server) and the /admin
// preview (client) — the caller supplies a footballer-id → name map.

import { toFlagEmoji } from './country-flags';
import type { Bet, ExactScoreSelection, FootballerSelection } from '@/types/db';

// Phrasing per prop type for the share digest. First vs anytime scorer read
// differently on purpose; distinct from the on-screen PROP_LABEL badges.
const PROP_SHARE: Record<string, (player: string) => string> = {
  first_scorer: p => `${p} to score first`,
  anytime_scorer: p => `${p} to score`,
  carded: p => `${p} booked`,
};

export function isShareProp(betType: string): boolean {
  return betType in PROP_SHARE;
}

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

    const prop = bs.find(b => isShareProp(b.bet_type));
    if (prop) {
      const name = playerName.get((prop.selection as FootballerSelection).footballer_id) ?? 'Player';
      lines.push(PROP_SHARE[prop.bet_type](name));
    }
  }
  lines.push('', '🔗 https://worldcupbets.vercel.app');
  return lines.join('\n');
}
