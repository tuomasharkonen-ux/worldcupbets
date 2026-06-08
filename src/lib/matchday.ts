// Match-day grouping — pure functions.
//
// Fixtures are grouped into *match days* by their North-American calendar day. We use a
// single west-coast reference zone: it's the latest NA wall clock, so a full evening's
// slate of games stays on one match day instead of spilling a late kickoff into the
// next. (Grouping only — kickoff *times* are shown to our audience in Helsinki time.)

const NA_TIMEZONE = 'America/Los_Angeles';

// YYYY-MM-DD calendar date of a kickoff in NA time — the match-day grouping key.
export function naDayKey(utc: string | Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: NA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(utc));
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// Human label for a match-day key, e.g. "Wed 11 Jun".
export function naDayLabel(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

// 1-based ordinal of `target`'s match day among all distinct match days in `allKickoffs`.
// Rest days don't count — only days that actually have fixtures are numbered, matching
// how the full schedule lays them out. Returns 0 if the target day isn't represented.
export function matchDayNumber(allKickoffs: (string | Date)[], target: string | Date): number {
  const targetDay = naDayKey(target);
  const days = [...new Set(allKickoffs.map(naDayKey))].sort();
  return days.indexOf(targetDay) + 1;
}
