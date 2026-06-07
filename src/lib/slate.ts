// Slate (betting-day) computation — pure functions.
//
// A *slate* is the set of matches whose kickoff falls between two consecutive
// day-boundaries. The boundary is a configurable Helsinki hour
// (`config.daily.rollover_hour_local`, default 09:00): matches kicking off between
// day D's boundary and day D+1's boundary belong to slate D. A game at 04:00
// Helsinki therefore belongs to the *previous evening's* slate (GAME_DESIGN §2).
//
// Slate membership is computed from `kickoff_at`, never stored. A slate is keyed by
// its calendar date in Helsinki, as an ISO `YYYY-MM-DD` string.

const TIMEZONE = 'Europe/Helsinki';

// Wall-clock Helsinki components of a UTC instant. We work from these rather than
// from UTC + a fixed offset so the boundary stays correct across DST changes.
function helsinkiParts(utc: Date): { year: number; month: number; day: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

// Format a UTC-based calendar date as YYYY-MM-DD (used only for date arithmetic on
// the Helsinki wall-clock date, so no timezone is involved in the output).
function isoDate(year: number, month: number, day: number): string {
  // Normalise via Date.UTC so day = 0 / overflow rolls correctly (e.g. June 0 → May 31).
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.toISOString().slice(0, 10);
}

// The slate a given kickoff belongs to, as a YYYY-MM-DD key.
export function slateKeyOf(kickoffUtc: string | Date, rolloverHourLocal: number): string {
  const { year, month, day, hour } = helsinkiParts(new Date(kickoffUtc));
  // Before the rollover hour → it's the tail of the previous day's slate.
  return hour < rolloverHourLocal ? isoDate(year, month, day - 1) : isoDate(year, month, day);
}

// The slate currently in focus given "now": the same formula applied to the present
// instant. Before the morning rollover this is still last night's (settling) slate;
// after it, the new evening's (betting) slate.
export function currentSlateKey(now: Date, rolloverHourLocal: number): string {
  return slateKeyOf(now, rolloverHourLocal);
}

// Group items carrying a kickoff into slates, keyed by slate date.
export function groupBySlate<T>(
  items: T[],
  kickoffOf: (item: T) => string | Date,
  rolloverHourLocal: number,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const key = slateKeyOf(kickoffOf(item), rolloverHourLocal);
    const bucket = out.get(key);
    if (bucket) bucket.push(item);
    else out.set(key, [item]);
  }
  return out;
}

// Human label for a slate key, e.g. "Mon 15 Jun". Pure (no "today" awareness).
export function slateLabel(slateKey: string): string {
  // slateKey is a Helsinki calendar date; render it as such without re-shifting tz.
  const [y, m, d] = slateKey.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
