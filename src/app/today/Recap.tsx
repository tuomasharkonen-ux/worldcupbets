'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { Coins, Sparkles, Trophy, ArrowRight, FastForward, ArrowUp, ArrowDown, CheckCircle2, XCircle, MinusCircle, Star, Shield, Crown } from 'lucide-react';
import { Flag } from '@/components/ui/flag';
import { Button } from '@/components/ui/button';
import { toFlagEmoji } from '@/lib/country-flags';
import { ShareBetsButton } from './ShareBetsButton';

// ─── data shapes (computed server-side over the slate's bets + ledger) ──────────

export interface RecapPick {
  label: string; // e.g. "Outcome", "Score", "First scorer"
  detail: string; // e.g. "Brazil", "2–1", "L. Messi"
  result: 'won' | 'lost' | 'void';
  points: number; // Points awarded for this pick (post-multiplier); 0 for a miss/void.
}

export interface RecapMatch {
  id: string;
  home: string;
  away: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number;
  awayScore: number;
  picks: RecapPick[];
  // One stake rides the whole match slip (GAME_DESIGN §5): Coins spent + the
  // multiplier applied to every pick. 0 when the slip wasn't staked.
  staked: number;
  stakeMult: number;
}

export interface RecapCoinItem {
  label: string;
  amount: number; // signed
}

// A favorite-team milestone or favorite-player match result that paid Points on this
// slate (migration 009). `kind` picks the icon; `points` can be negative (a booking).
export interface RecapFavoriteItem {
  kind: 'player' | 'team';
  label: string; // e.g. "Lionel Messi" or "Argentina"
  detail: string; // e.g. "2 goals" or "Reached the quarter-final"
  points: number;
}

// Finale only: one line of the viewer's own Golden Bracket, mirroring a match pick —
// the placement/scorer you called, whether it hit (exact), landed a top-4 consolation,
// or missed, and the Points it earned (straight from the ledger). Revealed one at a
// time so your bracket haul accumulates just like a match slip's.
export interface RecapGbItem {
  label: string; // "Champion", "Runner-up", "Third place", "Fourth place", "Top scorer", "Goal-tally bonus"
  detail: string; // the team/player you picked, e.g. "Spain"
  result: 'won' | 'consolation' | 'lost';
  points: number; // Points this line earned (0 for a miss)
}

export interface RecapStanding {
  id: string;
  name: string;
  before: number;
  after: number;
  rankBefore: number; // 1-based
  rankAfter: number;
  isYou: boolean;
  // Finale only (see `RecapData.finale`): the Points this manager gained on the slate,
  // and the Golden Bracket subset of it. On a normal recap these are left out and the
  // board shows rank movement only; on the finale they're rendered per-player so
  // *everyone's* final-day + bracket haul is visible, not just your own.
  gained?: number; // total slate delta (= after − before); bets + favorites + bracket
  gainedBracket?: number; // the Golden Bracket portion of `gained`
}

export interface RecapData {
  matchDay: number; // 1-based match-day number for this slate (see @/lib/matchday).
  matches: RecapMatch[];
  pointsGained: number; // headline total: bet Points + favorite (player + team) Points
  // Favorite-pick Points earned on this slate, itemised. Empty when nothing landed.
  favoriteItems: RecapFavoriteItem[];
  coinItems: RecapCoinItem[];
  coinsGained: number; // net signed
  standings: RecapStanding[];
  balance: number;
  // The season finale — the slate carrying the final. Swaps the leaderboard scene for a
  // grander board that reveals every manager's final-day + Golden Bracket points, crowns
  // the league winner, and re-themes the title + send-off. Absent/false on every other
  // recap (unchanged behaviour).
  finale?: boolean;
  // World Cup champion (the final's winner) — the title-scene hero on the finale.
  champion?: { name: string; code: string | null };
  // Finale only: the viewer's own Golden Bracket, itemised. When present (non-empty),
  // the finale plays a dedicated slip-style reveal of how the bracket Points added up.
  gbBreakdown?: RecapGbItem[];
}

// ─── motion helpers ─────────────────────────────────────────────────────────────

function subscribeReducedMotion(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    () => false, // server snapshot — assume motion is allowed during SSR
  );
}

// Count from 0 → target once `active`, easing out. Returns target instantly when
// `instant` (reduced motion). setValue only ever fires inside requestAnimationFrame,
// never synchronously in the effect body.
function useCountUp(target: number, active: boolean, instant: boolean, duration = 700): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!active || instant) return;
    const start = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, active, instant, duration]);
  if (instant) return target;
  return active ? value : 0;
}

// ─── match tiers — the FIFA-pack reveal ─────────────────────────────────────────

// How big a night each slip was, by the count of *winning* picks (voids don't count
// against you). Maps onto the user-facing card rarity: 3+ → legendary (gold), 2 →
// epic (purple), 1 → rare (green), 0 → common (silver, no flourish).
type Tier = 'legendary' | 'epic' | 'rare' | 'common';

function matchTier(picks: RecapPick[]): Tier {
  const hits = picks.filter(p => p.result === 'won').length;
  return hits >= 3 ? 'legendary' : hits === 2 ? 'epic' : hits === 1 ? 'rare' : 'common';
}

// Celebration class + heading copy per tier. The banner replaces the "Your bets"
// heading once the slip celebrates — a rarity word for hits, a wry "Damn" for a blank.
const TIER_META: Record<Tier, { cls: string; banner: string | null; text: string }> = {
  legendary: { cls: 'tier-legendary', banner: 'LEGENDARY', text: 'text-primary-bright' },
  epic: { cls: 'tier-epic', banner: 'EPIC', text: 'text-[#d8b4fe]' },
  rare: { cls: 'tier-rare', banner: 'NICE', text: 'text-success' },
  // 0 hits stays visually silver (no shine/confetti) but swaps the heading to a wry
  // "Damn" reaction instead of keeping the neutral "Your bets".
  common: { cls: 'tier-common', banner: 'Damn', text: 'text-subtle' },
};

// Confetti palette + intensity per tier — bolder and wider for the rarer cards.
// `null` = no confetti (common).
const TIER_CONFETTI: Record<Tier, { colors: string[]; count: number; spread: number } | null> = {
  legendary: { colors: ['#ffd166', '#fff7d6', '#f0a830', '#ffffff'], count: 60, spread: 1.45 },
  epic: { colors: ['#c084fc', '#d8b4fe', '#a763eb', '#f0abfc'], count: 42, spread: 1.2 },
  rare: { colors: ['#4ade80', '#86efac', '#bbf7d0'], count: 12, spread: 0.8 },
  common: null,
};

function Confetti({ tier }: { tier: Tier }) {
  const cfg = TIER_CONFETTI[tier];
  if (!cfg) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: cfg.count }).map((_, i) => {
        const angle = (i / cfg.count) * Math.PI * 2;
        const dist = (40 + (i % 4) * 16) * cfg.spread;
        const style: React.CSSProperties = {
          left: '50%',
          top: '42%',
          background: cfg.colors[i % cfg.colors.length],
          ['--cx' as string]: `${Math.cos(angle) * dist}px`,
          ['--cy' as string]: `${Math.sin(angle) * dist + 30}px`,
          ['--cr' as string]: `${(i % 2 ? 1 : -1) * 240}deg`,
          animationDelay: `${(i % 6) * 28}ms`,
        };
        return <span key={i} className="confetti-piece absolute size-1.5 rounded-[1px]" style={style} />;
      })}
    </div>
  );
}

// Small numbered marker for the end-of-recap step guide.
function StepDot({ n }: { n: number }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface-3 font-mono text-[0.7rem] font-bold text-foreground">
      {n}
    </span>
  );
}

const RESULT_STYLE = {
  won: { color: 'text-success', Icon: CheckCircle2, tag: 'HIT' },
  lost: { color: 'text-danger', Icon: XCircle, tag: 'MISS' },
  void: { color: 'text-subtle', Icon: MinusCircle, tag: 'VOID' },
  // Golden Bracket only: a right-team-wrong-slot consolation (a team you placed
  // finished in the top four, just not in the slot you called).
  consolation: { color: 'text-points', Icon: Star, tag: 'TOP 4' },
} as const;

// The shape one reveal line needs — shared by match picks (RecapPick, a subset of the
// result union) and Golden Bracket items (which also use 'consolation').
type RevealItem = { label: string; detail: string; result: keyof typeof RESULT_STYLE; points: number };

// Reveal choreography timing (ms). First the final scoreline floats in, then — after
// LEAD — picks reveal one at a time, each as a slow four-beat micro-sequence: label →
// detail → result badge → points count-up. PICK_TOTAL is one pick's full beat (the
// parent spaces picks by it so they never overlap); CELEBRATE_HOLD is how long the tier
// celebration breathes before the recap auto-advances.
const LEAD_MS = 750; // scoreline float-in + a beat, before the first pick begins listing
const SUB_LABEL_MS = 340; // label shown → reveal detail ("Brazil wins")
const SUB_DETAIL_MS = 340; // detail shown → stamp the result badge (HIT/MISS)
const SUB_BADGE_MS = 340; // badge stamped → start the points odometer
const SUB_COUNT_MS = 560; // points count-up duration
const PICK_TAIL_MS = 280; // breath after a pick fully lands, before the next begins
const PICK_TOTAL_MS = SUB_LABEL_MS + SUB_DETAIL_MS + SUB_BADGE_MS + SUB_COUNT_MS + PICK_TAIL_MS;
const CELEBRATE_HOLD = 1500;

// One pick line, revealed as a slow four-beat sequence while animating: the label
// drops in first, then the detail, then the result badge stamps, then the points count
// up. The badge + points slots reserve their width from the start so nothing reflows as
// each beat lands. `animate` is false on the static end-state (past matches / reduced
// motion), where everything shows at once with an instant total.
function PickRow({ pick, animate, reduced }: { pick: RevealItem; animate: boolean; reduced: boolean }) {
  const s = RESULT_STYLE[pick.result];
  const hit = pick.points > 0;

  // beat: 0 label · 1 +detail · 2 +badge · 3 +points
  const [beat, setBeat] = useState(animate ? 0 : 3);
  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setBeat(1), SUB_LABEL_MS));
    timers.push(setTimeout(() => setBeat(2), SUB_LABEL_MS + SUB_DETAIL_MS));
    timers.push(setTimeout(() => setBeat(3), SUB_LABEL_MS + SUB_DETAIL_MS + SUB_BADGE_MS));
    return () => timers.forEach(clearTimeout);
  }, [animate]);

  const showDetail = beat >= 1;
  const showBadge = beat >= 2;
  const showPoints = beat >= 3;
  const counted = useCountUp(pick.points, animate ? showPoints : true, !animate || reduced || !hit, SUB_COUNT_MS);

  // Static end-state — plain, fully revealed, no per-beat motion.
  if (!animate) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-muted">
          <span className="text-subtle">{pick.label}:</span> {pick.detail}
        </span>
        <span className={`inline-flex w-16 shrink-0 items-center justify-end gap-1 text-xs font-bold ${s.color}`}>
          <s.Icon className="size-4" aria-hidden />
          {s.tag}
        </span>
        <span className={`w-[3.75rem] shrink-0 text-right font-mono text-sm font-bold tabular-nums ${hit ? 'text-points' : 'text-subtle'}`}>
          {hit ? `+${pick.points}` : '0'}
          <span className="ml-0.5 text-[0.65rem] font-medium opacity-80">pts</span>
        </span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.7 }}
      className="flex items-center gap-2 text-sm"
    >
      <span className="min-w-0 flex-1 truncate text-muted">
        <span className="text-subtle">{pick.label}:</span>{' '}
        <motion.span
          className="inline-block"
          initial={{ opacity: 0, x: -6 }}
          animate={showDetail ? { opacity: 1, x: 0 } : { opacity: 0, x: -6 }}
          transition={{ type: 'spring', stiffness: 460, damping: 28 }}
        >
          {pick.detail}
        </motion.span>
      </span>
      <motion.span
        className={`inline-flex w-16 shrink-0 items-center justify-end gap-1 text-xs font-bold ${s.color}`}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={showBadge ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
        transition={{ type: 'spring', stiffness: 600, damping: 18 }}
      >
        <s.Icon className="size-4" aria-hidden />
        {s.tag}
      </motion.span>
      <motion.span
        className={`w-[3.75rem] shrink-0 text-right font-mono text-sm font-bold tabular-nums ${hit ? 'text-points' : 'text-subtle'}`}
        initial={{ opacity: 0 }}
        animate={showPoints ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {hit ? `+${counted}` : '0'}
        <span className="ml-0.5 text-[0.65rem] font-medium opacity-80">pts</span>
      </motion.span>
    </motion.div>
  );
}

// A single match slip in the recap. While `phase === 'active'` it reveals its picks
// one at a time (each counting up), then — once the last lands — fires the tier
// celebration (border glow, light sweep, confetti) and reports `onRevealed` so the
// parent can hold, then advance. `phase === 'past'` (and reduced motion) renders the
// finished, already-celebrated end-state with no animation.
function MatchReveal({
  match,
  phase,
  reduced,
  onRevealed,
}: {
  match: RecapMatch;
  phase: 'active' | 'past';
  reduced: boolean;
  onRevealed: () => void;
}) {
  const picks = match.picks;
  const total = picks.length;
  const tier = matchTier(picks);
  const meta = TIER_META[tier];
  const animate = phase === 'active' && !reduced;

  // Live reveal progress while animating. On the static end-state (`past` / reduced
  // motion) we derive the finished values during render instead, so the effect never
  // needs to setState synchronously.
  const [revealedRaw, setRevealedRaw] = useState(animate ? 0 : total);
  const [celebratingRaw, setCelebratingRaw] = useState(!animate);
  const revealed = animate ? revealedRaw : total;
  const celebrating = animate ? celebratingRaw : true;

  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    picks.forEach((_, i) => {
      timers.push(setTimeout(() => setRevealedRaw(i + 1), LEAD_MS + i * PICK_TOTAL_MS));
    });
    timers.push(
      setTimeout(() => {
        setCelebratingRaw(true);
        onRevealed();
      }, LEAD_MS + Math.max(total, 1) * PICK_TOTAL_MS),
    );
    return () => timers.forEach(clearTimeout);
    // onRevealed is a stable parent setter; re-run only when this slip starts animating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, match.id]);

  const tierCls = celebrating ? meta.cls : '';
  const showFlair = celebrating && tier !== 'common';

  // The "Your bets" heading shows once listing begins (first pick revealed, or the
  // static end-state); on celebration its text swaps to the rarity banner. Slips with
  // no bets skip the heading entirely.
  const listing = total > 0 && (!animate || revealed > 0 || celebrating);
  const tierHeading = celebrating && meta.banner;

  return (
    <motion.div
      animate={animate && celebrating ? { scale: [1, 1.035, 1] } : { scale: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={`glass relative overflow-hidden rounded-2xl px-4 py-3.5 transition-colors duration-500 ${tierCls}`}
    >
      {showFlair && <span className={`tier-shine ${tier}`} aria-hidden />}
      {animate && celebrating && <Confetti tier={tier} />}

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <span className="flex min-w-0 items-center justify-end gap-2 font-display font-semibold text-foreground">
          <span className="truncate">{match.home}</span>
          <Flag name={match.home} countryCode={match.homeCode} size="sm" />
        </span>
        <motion.span
          initial={animate ? { opacity: 0, y: 12 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          className="rounded-lg bg-surface-3 px-2.5 py-1 font-mono text-lg font-bold tabular-nums text-foreground"
        >
          {match.homeScore}<span className="px-1 text-subtle">–</span>{match.awayScore}
        </motion.span>
        <span className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
          <Flag name={match.away} countryCode={match.awayCode} size="sm" />
          <span className="truncate">{match.away}</span>
        </span>
      </div>

      {listing && (
        <div className="relative mt-3 mb-1.5 flex min-h-[1.1rem] items-center justify-center">
          <AnimatePresence mode="wait" initial={false}>
            {tierHeading ? (
              <motion.p
                key="tier"
                initial={animate ? { opacity: 0, scale: 0.9, letterSpacing: '0.12em' } : false}
                animate={{ opacity: 1, scale: 1, letterSpacing: '0.3em' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className={`font-display text-xs font-bold uppercase ${meta.text}`}
              >
                {meta.banner}
              </motion.p>
            ) : (
              <motion.p
                key="label"
                initial={animate ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="text-xs font-semibold uppercase tracking-wider text-subtle"
              >
                Your bets
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="space-y-1.5">
        {total === 0 && <p className="mt-3 text-center text-xs text-subtle">No bets on this match.</p>}
        {picks.slice(0, revealed).map((p, j) => (
          <PickRow key={j} pick={p} animate={animate} reduced={reduced} />
        ))}
      </div>

      {match.staked > 0 && (
        <p className="relative mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-2.5 text-xs text-points">
          <Coins className="size-3.5" aria-hidden />
          {match.staked}¢ staked · ×{match.stakeMult} on every pick
        </p>
      )}
    </motion.div>
  );
}

// ─── share text ─────────────────────────────────────────────────────────────────

// A spoiler-free, Wordle-style results grid for pasting into a chat. Each match is
// one row — both flags around a 3-cell pattern for outcome · exact score · prop
// (🟩 hit · ⬛ miss · ⬜ no bet) — with the night's points and the manager's new
// leaderboard position below. Deliberately omits the picks themselves. On the finale
// the points are split into the match haul and the Golden Bracket haul, then totalled.
function buildRecapShareText(data: RecapData): string {
  const cell = (pick: RecapPick | undefined): string =>
    !pick ? '⬜' : pick.result === 'won' ? '🟩' : pick.result === 'void' ? '⬜' : '⬛';
  // Flag emoji, or the country code when one won't render (UK home nations).
  const side = (name: string, code: string | null): string =>
    toFlagEmoji(name, code) ?? code?.toUpperCase() ?? name;

  const lines: string[] = [data.finale ? '🏆 World Cup 2026 — Final' : `⚽ Match Day ${data.matchDay}`, ''];
  for (const m of data.matches) {
    const outcome = m.picks.find(p => p.label === 'Outcome');
    const score = m.picks.find(p => p.label === 'Score');
    const prop = m.picks.find(p => p.label !== 'Outcome' && p.label !== 'Score');
    const grid = `${cell(outcome)}${cell(score)}${cell(prop)}`;
    lines.push(`${side(m.home, m.homeCode)} ${grid} ${side(m.away, m.awayCode)}`);
  }

  // Finale: break the haul into match + Golden Bracket, then total. Otherwise the
  // single night's-points line, unchanged.
  if (data.finale) {
    const gbTotal = (data.gbBreakdown ?? []).reduce((s, it) => s + it.points, 0);
    lines.push('', `⚽ Final +${data.pointsGained} pts`);
    if (data.gbBreakdown?.length) lines.push(`🥇 Golden Bracket +${gbTotal} pts`);
    lines.push(`✨ Total +${data.pointsGained + gbTotal} pts`);
  } else {
    lines.push('', `✨ +${data.pointsGained} pts`);
  }
  const me = data.standings.find(s => s.isYou);
  if (me) {
    const delta = me.rankBefore - me.rankAfter; // +ve = climbed
    const move = delta > 0 ? ` ▲${delta}` : delta < 0 ? ` ▼${-delta}` : '';
    lines.push(data.finale ? `🏅 Finished ${ordinal(me.rankAfter)}` : `🏆 ${ordinal(me.rankAfter)}${move}`);
  }

  lines.push('', '🔗 https://worldcupbets.vercel.app');
  return lines.join('\n');
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

// ─── finale scenes ───────────────────────────────────────────────────────────────

// Podium accent per top-3 rank (gold / silver / bronze); everyone else is plain.
const PODIUM: Record<number, { ring: string; text: string }> = {
  1: { ring: 'ring-[color:var(--color-points)]', text: 'text-points' },
  2: { ring: 'ring-white/40', text: 'text-foreground/70' },
  3: { ring: 'ring-[#cd7f32]/60', text: 'text-[#e0a06a]' },
};

// The title-scene hero on the finale: the World Cup champion, flag + name under a crown.
function ChampionHero({ champion, animate }: { champion: { name: string; code: string | null }; animate: boolean }) {
  return (
    <div className={`glass-strong tier-legendary relative mt-4 overflow-hidden rounded-2xl px-4 py-5 ${animate ? 'animate-rise-in' : ''}`}>
      <span className="tier-shine legendary" aria-hidden />
      {animate && <Confetti tier="legendary" />}
      <p className="relative flex items-center justify-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-subtle">
        <Crown className="size-3.5 text-points" aria-hidden />
        World Cup champions
      </p>
      <div className="relative mt-2 flex items-center justify-center gap-3">
        <Flag name={champion.name} countryCode={champion.code} size="lg" />
        <span className="text-glow font-display text-2xl font-bold tracking-tight text-foreground">
          {champion.name}
        </span>
      </div>
    </div>
  );
}

// One finale standings row. Unlike the plain board, the manager's whole-tournament total
// counts up from `before` → `after` and the slate haul is broken out into its final-day
// and Golden Bracket parts, so every player's night is on show — not just yours.
function FinaleRow({ s, active, reduced, index }: { s: RecapStanding; active: boolean; reduced: boolean; index: number }) {
  const gained = s.gained ?? s.after - s.before;
  const bracket = s.gainedBracket ?? 0;
  const fromMatch = gained - bracket;
  const counted = useCountUp(gained, active, reduced, 900);
  const total = s.before + counted;
  const delta = s.rankBefore - s.rankAfter; // +ve = climbed
  const podium = PODIUM[s.rankAfter];
  const isChamp = s.rankAfter === 1;

  return (
    <motion.li
      initial={active && !reduced ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 28, delay: reduced ? 0 : index * 0.08 }}
      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
        isChamp
          ? 'tier-legendary bg-[color-mix(in_oklab,var(--color-points)_16%,transparent)]'
          : s.isYou
            ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_14%,transparent)]'
            : ''
      }`}
    >
      <span
        className={`flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-sm font-bold tabular-nums ${
          podium ? `bg-surface-3 ring-1 ${podium.ring} ${podium.text}` : 'text-subtle'
        }`}
      >
        {isChamp ? <Crown className="size-4" aria-hidden /> : s.rankAfter}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={`min-w-0 truncate font-medium ${s.isYou || isChamp ? 'text-foreground' : 'text-muted'}`}>
            {s.name}
          </span>
          {s.isYou && <span className="shrink-0 text-xs text-primary-bright">(you)</span>}
          {delta !== 0 && (
            <span className={`inline-flex shrink-0 items-center text-xs font-semibold ${delta > 0 ? 'text-success' : 'text-danger'}`}>
              {delta > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
              {Math.abs(delta)}
            </span>
          )}
        </div>
        {gained !== 0 && (
          <p className="mt-0.5 flex items-center gap-1.5 text-[0.7rem] text-subtle">
            <span className={fromMatch >= 0 ? 'text-muted' : 'text-danger'}>
              Final {fromMatch >= 0 ? `+${fromMatch}` : fromMatch}
            </span>
            {bracket !== 0 && (
              <span className="flex items-center gap-1 text-points">
                <Sparkles className="size-3" aria-hidden />
                Bracket +{bracket}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-base font-bold tabular-nums text-foreground">{total}</p>
        {gained > 0 && <p className="font-mono text-[0.7rem] font-semibold tabular-nums text-points">+{gained}</p>}
      </div>
    </motion.li>
  );
}

// The finale's Golden Bracket slip — the viewer's own bracket revealed like a match
// slip: each placement/scorer call lists in turn with its Points counting up, then the
// bracket total lands under a legendary flourish. `phase === 'active'` animates the
// reveal and reports done via `onRevealed`; 'past' / reduced motion is the static
// end-state. Reuses the exact match-pick choreography (PickRow + the LEAD/PICK timings).
function GbReveal({
  items,
  total,
  phase,
  reduced,
  onRevealed,
}: {
  items: RecapGbItem[];
  total: number;
  phase: 'active' | 'past';
  reduced: boolean;
  onRevealed: () => void;
}) {
  const animate = phase === 'active' && !reduced;
  const count = items.length;
  const [revealedRaw, setRevealedRaw] = useState(animate ? 0 : count);
  const [doneRaw, setDoneRaw] = useState(!animate);
  const revealed = animate ? revealedRaw : count;
  const done = animate ? doneRaw : true;

  useEffect(() => {
    if (!animate) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    items.forEach((_, i) => {
      timers.push(setTimeout(() => setRevealedRaw(i + 1), LEAD_MS + i * PICK_TOTAL_MS));
    });
    timers.push(
      setTimeout(() => {
        setDoneRaw(true);
        onRevealed();
      }, LEAD_MS + Math.max(count, 1) * PICK_TOTAL_MS),
    );
    return () => timers.forEach(clearTimeout);
    // onRevealed is a stable parent setter; run once when the slip starts animating.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate]);

  const totalCount = useCountUp(total, done, !animate || reduced, SUB_COUNT_MS);
  const flair = done && total > 0;

  return (
    <div className={`glass relative overflow-hidden rounded-2xl border border-points/30 px-4 py-3.5 transition-colors duration-500 ${flair ? 'tier-legendary' : ''}`}>
      {flair && <span className="tier-shine legendary" aria-hidden />}
      <p className="relative mb-2 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
        <Crown className="size-3.5 text-points" aria-hidden />
        Your Golden Bracket
      </p>
      <div className="relative space-y-1.5">
        {items.slice(0, revealed).map((it, i) => (
          <PickRow key={i} pick={it} animate={animate} reduced={reduced} />
        ))}
      </div>
      {done && (
        <p className="relative mt-3 flex items-center justify-center gap-1.5 border-t border-border pt-2.5 text-sm font-bold text-points">
          <Sparkles className="size-3.5" aria-hidden />
          Bracket total +{totalCount} pts
        </p>
      )}
    </div>
  );
}

// The finale leaderboard scene — replaces the plain standings block. `active` gates the
// per-row count-up so it fires when the scene lands.
function FinaleBoard({ standings, active, reduced }: { standings: RecapStanding[]; active: boolean; reduced: boolean }) {
  return (
    <div className={`glass-strong rounded-2xl px-4 py-4 ${active && !reduced ? 'animate-rise-in' : ''}`}>
      <p className="mb-1 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
        <Trophy className="size-3.5 text-points" aria-hidden />
        Final standings
      </p>
      <p className="mb-3 text-center text-[0.7rem] text-subtle">Final &amp; Golden Bracket points, in</p>
      <ul className="space-y-1.5">
        {standings.map((s, i) => (
          <FinaleRow key={s.id} s={s} active={active} reduced={reduced} index={i} />
        ))}
      </ul>
    </div>
  );
}

// ─── the recap ────────────────────────────────────────────────────────────────

// `doneAction` is the server action that records the recap as seen — wired to the
// "Next match day" button so the page can move on. Optional only for the /admin
// preview, which renders the recap with mock data and no session.
export function Recap({ data, doneAction }: { data: RecapData; doneAction?: () => Promise<void> }) {
  const reduced = useReducedMotion();
  const M = data.matches.length;
  // The finale adds a Golden Bracket slip between the match reveals and the points
  // scene, but only when the viewer actually placed a bracket (non-empty breakdown).
  const gbItems = data.gbBreakdown ?? [];
  const hasGb = !!data.finale && gbItems.length > 0;
  const gbScene = hasGb ? M + 1 : -1;
  const G = hasGb ? 1 : 0;
  const gbTotal = gbItems.reduce((s, it) => s + it.points, 0);
  // scene indices: 0 title · 1..M matches · [M+1 golden bracket] · points · coins · board · cta
  const POINTS = M + 1 + G;
  const COINS = M + 2 + G;
  const BOARD = M + 3 + G;
  const CTA = M + 4 + G;
  const TOTAL = M + 5 + G;
  const lastScene = TOTAL - 1;

  // Reduced motion is known on first render (useSyncExternalStore), so start straight
  // at the full static end-state; otherwise begin at the title and auto-advance.
  const [step, setStep] = useState(() => (reduced ? lastScene : 0));

  // Reveal scenes (each match slip, and the Golden Bracket slip) don't advance on a
  // fixed timer — they wait for the slip to finish listing its picks and celebrate
  // first. Each reports the scene it just finished via `onRevealed`; the gate is open
  // only once the *current* reveal scene has reported, and reopens when `step` moves on.
  const isMatchScene = step >= 1 && step <= M;
  const isGbScene = hasGb && step === gbScene;
  const isRevealScene = isMatchScene || isGbScene;
  const [settledScene, setSettledScene] = useState(0);
  const revealSettled = isRevealScene && settledScene === step;

  useEffect(() => {
    if (reduced || step >= lastScene) return;
    if (isRevealScene && !revealSettled) return; // hold until the slip has finished revealing
    const delay = isRevealScene ? CELEBRATE_HOLD : 1500;
    const t = setTimeout(() => setStep(s => Math.min(lastScene, s + 1)), delay);
    return () => clearTimeout(t);
  }, [step, reduced, lastScene, isRevealScene, revealSettled]);

  // The recap auto-plays; the only manual control is skipping the whole show to the
  // static end-state. No tap-to-advance — you either watch it or skip it all.
  const skipAnimations = () => setStep(lastScene);

  const shown = (scene: number) => step >= scene;
  const justNow = (scene: number) => step === scene && !reduced; // first frame of a scene

  const pointsValue = useCountUp(data.pointsGained, shown(POINTS), reduced);
  const coinsValue = useCountUp(Math.abs(data.coinsGained), shown(COINS), reduced);

  const boardAfter = [...data.standings].sort((a, b) => a.rankAfter - b.rankAfter);

  return (
    <div className="relative" role="region" aria-label="Morning recap">
      {step < lastScene && (
        <button
          type="button"
          onClick={skipAnimations}
          className="absolute -top-2 right-0 z-10 inline-flex items-center gap-1 text-[0.7rem] font-medium text-subtle transition-colors hover:text-foreground"
        >
          <FastForward className="size-3" aria-hidden />
          Skip animations
        </button>
      )}

      <div className="space-y-4">
        {/* 0 — title (finale re-themes it and crowns the champion) */}
        {shown(0) && (
          <div className={`text-center ${justNow(0) ? 'animate-rise-in' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">
              {data.finale ? 'The final whistle' : 'Last night'}
            </p>
            <h1 className="text-glow mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
              {data.finale ? 'World Cup 2026' : `Match day ${data.matchDay}`}
            </h1>
            {data.finale && data.champion && (
              <ChampionHero champion={data.champion} animate={justNow(0)} />
            )}
          </div>
        )}

        {/* 1..M — match-by-match: pick-by-pick reveal, then a tier celebration */}
        {data.matches.map((m, i) => {
          const scene = i + 1;
          if (!shown(scene)) return null;
          return (
            <MatchReveal
              key={m.id}
              match={m}
              phase={step === scene ? 'active' : 'past'}
              reduced={reduced}
              onRevealed={() => setSettledScene(scene)}
            />
          );
        })}

        {/* M+1 (finale, if a bracket was placed) — Golden Bracket slip: your bracket
            revealed pick-by-pick, exactly like a match slip, tallying to its total. */}
        {hasGb && shown(gbScene) && (
          <GbReveal
            items={gbItems}
            total={gbTotal}
            phase={step === gbScene ? 'active' : 'past'}
            reduced={reduced}
            onRevealed={() => setSettledScene(gbScene)}
          />
        )}

        {/* points odometer. A favorite-team milestone (kind 'team' — the ladder
            rungs/champion/third) gets the same legendary gold treatment as a 3/3 match
            slip (tier-legendary glow + shine), so the moment reads as a comparable jackpot. */}
        {shown(POINTS) && (() => {
          const hasMilestone = data.favoriteItems.some(it => it.kind === 'team');
          return (
            <div
              className={`glass-strong relative overflow-hidden rounded-2xl px-4 py-5 text-center transition-colors duration-500 ${hasMilestone ? 'tier-legendary' : ''} ${justNow(POINTS) ? 'animate-rise-in' : ''}`}
            >
              {hasMilestone && <span className="tier-shine legendary" aria-hidden />}
              {justNow(POINTS) && data.pointsGained > 0 && <Confetti tier="legendary" />}
              <p className="relative flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
                <Sparkles className="size-3.5 text-points" aria-hidden />
                Points won
              </p>
              <p className="text-glow relative mt-1 font-mono text-4xl font-bold tabular-nums text-points">
                +{pointsValue}
              </p>
              {data.favoriteItems.length > 0 && (
                <ul className="relative mt-4 space-y-1.5 border-t border-border pt-3 text-left">
                  {data.favoriteItems.map((it, i) => {
                    const milestone = it.kind === 'team';
                    return (
                      <li
                        key={i}
                        className={`flex items-center gap-2 text-sm ${
                          milestone ? 'rounded-lg bg-[color-mix(in_oklab,var(--color-primary-bright)_14%,transparent)] px-2 py-1.5' : ''
                        }`}
                      >
                        {it.kind === 'player' ? (
                          <Star className="size-4 shrink-0 text-points" aria-hidden />
                        ) : (
                          <Shield className="size-4 shrink-0 text-primary-bright" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate text-muted">
                          <span
                            className={
                              milestone
                                ? 'text-glow font-display font-bold uppercase tracking-wide text-primary-bright'
                                : 'font-semibold text-foreground'
                            }
                          >
                            {it.label}
                          </span>
                          <span className={milestone ? 'text-foreground/80' : 'text-subtle'}> · {it.detail}</span>
                        </span>
                        <span
                          className={`shrink-0 text-right font-mono font-bold tabular-nums ${
                            milestone
                              ? 'text-glow text-base text-primary-bright'
                              : `text-sm ${it.points >= 0 ? 'text-points' : 'text-danger'}`
                          }`}
                        >
                          {it.points >= 0 ? `+${it.points}` : it.points}
                          <span className="ml-0.5 text-[0.65rem] font-medium opacity-80">pts</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })()}

        {/* coins cascade */}
        {shown(COINS) && (
          <div className={`glass rounded-2xl px-4 py-4 ${justNow(COINS) ? 'animate-rise-in' : ''}`}>
            <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-subtle">
              <span className="flex items-center gap-1.5">
                <Coins className="size-3.5 text-points" aria-hidden />
                Coins
              </span>
              <span className={`font-mono text-base ${data.coinsGained >= 0 ? 'text-success' : 'text-danger'}`}>
                {data.coinsGained >= 0 ? '+' : '−'}{coinsValue}¢
              </span>
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {data.coinItems.length === 0 && <li className="text-subtle">No Coin movement.</li>}
              {data.coinItems.map((it, i) => (
                <li key={i} className="flex items-center justify-between">
                  <span className="text-muted">{it.label}</span>
                  <span className={`font-mono ${it.amount >= 0 ? 'text-success' : 'text-danger'}`}>
                    {it.amount >= 0 ? '+' : '−'}{Math.abs(it.amount)}¢
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* leaderboard. The finale swaps the plain FLIP board for the grand one
            that reveals every manager's final-day + Golden Bracket haul (the emphasis). */}
        {shown(BOARD) && data.finale && (
          <FinaleBoard standings={boardAfter} active={shown(BOARD)} reduced={reduced} />
        )}
        {shown(BOARD) && !data.finale && (
          <div className={`glass rounded-2xl px-4 py-4 ${justNow(BOARD) ? 'animate-rise-in' : ''}`}>
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <Trophy className="size-3.5 text-points" aria-hidden />
              Standings
            </p>
            <ul className="space-y-1.5">
              {boardAfter.map(s => {
                const delta = s.rankBefore - s.rankAfter; // +ve = moved up
                return (
                  <li
                    key={s.id}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-500 ${s.isYou ? 'bg-[color-mix(in_oklab,var(--color-primary-bright)_14%,transparent)]' : ''}`}
                  >
                    <span className="w-5 text-center font-mono text-sm font-bold tabular-nums text-subtle">{s.rankAfter}</span>
                    <span className={`min-w-0 flex-1 truncate font-medium ${s.isYou ? 'text-foreground' : 'text-muted'}`}>
                      {s.name}{s.isYou && <span className="ml-1 text-xs text-primary-bright">(you)</span>}
                    </span>
                    {delta !== 0 && (
                      <span className={`inline-flex items-center text-xs font-semibold ${delta > 0 ? 'text-success' : 'text-danger'}`}>
                        {delta > 0 ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
                        {Math.abs(delta)}
                      </span>
                    )}
                    <span className="w-14 text-right font-mono text-sm font-bold tabular-nums text-foreground">{s.after}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* shop CTA (finale swaps it for a tournament send-off) */}
        {shown(CTA) && data.finale && (
          <div className={`glass-strong rounded-2xl px-4 py-6 text-center ${justNow(CTA) ? 'animate-rise-in' : ''}`}>
            <Trophy className="mx-auto size-8 text-points" aria-hidden />
            <p className="text-glow mt-2 font-display text-xl font-bold text-foreground">That’s a wrap</p>
            <p className="mt-1 text-sm text-muted">
              The World Cup is over. Thanks for playing — check the leaderboard for the final word.
            </p>
          </div>
        )}
        {shown(CTA) && !data.finale && (
          <div className={`glass-strong rounded-2xl px-4 py-5 text-center ${justNow(CTA) ? 'animate-rise-in' : ''}`}>
            <p className="text-sm text-muted">You have</p>
            <p className="text-glow my-1 font-mono text-3xl font-bold tabular-nums text-points">{data.balance}¢</p>
            <p className="text-sm text-muted">to spend. The shop opens soon.</p>
          </div>
        )}
      </div>

      {step >= lastScene && (
        // Step-by-step send-off: share first, then move on — both full-weight buttons
        // so neither outshines the other.
        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <p className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
              <StepDot n={1} />
              First — share the night
            </p>
            <ShareBetsButton text={buildRecapShareText(data)} label="Share my results" />
          </div>
          <div className="space-y-2">
            <p className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
              <StepDot n={2} />
              {data.finale ? 'Then — see where you finished' : 'Then — on to the next one'}
            </p>
            {doneAction ? (
              <form action={doneAction}>
                <Button type="submit" variant="primary" size="lg" className="w-full">
                  {data.finale ? 'Final leaderboard' : 'Next match day'}
                  <ArrowRight className="size-5" aria-hidden />
                </Button>
              </form>
            ) : (
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href={data.finale ? '/leaderboard' : '/today'}>
                  {data.finale ? 'Final leaderboard' : 'Next match day'}
                  <ArrowRight className="size-5" aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
