'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { Coins, Sparkles, Trophy, ArrowRight, FastForward, ArrowUp, ArrowDown, CheckCircle2, XCircle, MinusCircle, Star, Shield } from 'lucide-react';
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

export interface RecapStanding {
  id: string;
  name: string;
  before: number;
  after: number;
  rankBefore: number; // 1-based
  rankAfter: number;
  isYou: boolean;
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
} as const;

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
function PickRow({ pick, animate, reduced }: { pick: RecapPick; animate: boolean; reduced: boolean }) {
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
// leaderboard position below. Deliberately omits the picks themselves.
function buildRecapShareText(data: RecapData): string {
  const cell = (pick: RecapPick | undefined): string =>
    !pick ? '⬜' : pick.result === 'won' ? '🟩' : pick.result === 'void' ? '⬜' : '⬛';
  // Flag emoji, or the country code when one won't render (UK home nations).
  const side = (name: string, code: string | null): string =>
    toFlagEmoji(name, code) ?? code?.toUpperCase() ?? name;

  const lines: string[] = [`⚽ Match Day ${data.matchDay}`, ''];
  for (const m of data.matches) {
    const outcome = m.picks.find(p => p.label === 'Outcome');
    const score = m.picks.find(p => p.label === 'Score');
    const prop = m.picks.find(p => p.label !== 'Outcome' && p.label !== 'Score');
    const grid = `${cell(outcome)}${cell(score)}${cell(prop)}`;
    lines.push(`${side(m.home, m.homeCode)} ${grid} ${side(m.away, m.awayCode)}`);
  }

  lines.push('', `✨ +${data.pointsGained} pts`);
  const me = data.standings.find(s => s.isYou);
  if (me) {
    const delta = me.rankBefore - me.rankAfter; // +ve = climbed
    const move = delta > 0 ? ` ▲${delta}` : delta < 0 ? ` ▼${-delta}` : '';
    lines.push(`🏆 ${ordinal(me.rankAfter)}${move}`);
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

// ─── the recap ────────────────────────────────────────────────────────────────

// `doneAction` is the server action that records the recap as seen — wired to the
// "Next match day" button so the page can move on. Optional only for the /admin
// preview, which renders the recap with mock data and no session.
export function Recap({ data, doneAction }: { data: RecapData; doneAction?: () => Promise<void> }) {
  const reduced = useReducedMotion();
  const M = data.matches.length;
  // scene indices: 0 title · 1..M matches · M+1 points · M+2 coins · M+3 board · M+4 cta
  const TOTAL = M + 5;
  const lastScene = TOTAL - 1;

  // Reduced motion is known on first render (useSyncExternalStore), so start straight
  // at the full static end-state; otherwise begin at the title and auto-advance.
  const [step, setStep] = useState(() => (reduced ? lastScene : 0));

  // Match scenes don't advance on a fixed timer — they wait for the slip to finish
  // revealing its picks and play the tier celebration first. `MatchReveal` reports the
  // scene it just finished via `onRevealed`; the gate is open only once the *current*
  // match scene has reported, and reopens automatically when `step` moves on.
  const isMatchScene = step >= 1 && step <= M;
  const [settledScene, setSettledScene] = useState(0);
  const matchSettled = isMatchScene && settledScene === step;

  useEffect(() => {
    if (reduced || step >= lastScene) return;
    if (isMatchScene && !matchSettled) return; // hold until the slip has celebrated
    const delay = isMatchScene ? CELEBRATE_HOLD : 1500;
    const t = setTimeout(() => setStep(s => Math.min(lastScene, s + 1)), delay);
    return () => clearTimeout(t);
  }, [step, reduced, lastScene, isMatchScene, matchSettled]);

  // The recap auto-plays; the only manual control is skipping the whole show to the
  // static end-state. No tap-to-advance — you either watch it or skip it all.
  const skipAnimations = () => setStep(lastScene);

  const shown = (scene: number) => step >= scene;
  const justNow = (scene: number) => step === scene && !reduced; // first frame of a scene

  const pointsValue = useCountUp(data.pointsGained, shown(M + 1), reduced);
  const coinsValue = useCountUp(Math.abs(data.coinsGained), shown(M + 2), reduced);

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
        {/* 0 — title */}
        {shown(0) && (
          <div className={`text-center ${justNow(0) ? 'animate-rise-in' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Last night</p>
            <h1 className="text-glow mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
              Match day {data.matchDay}
            </h1>
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

        {/* M+1 — points odometer */}
        {shown(M + 1) && (
          <div className={`glass-strong relative overflow-hidden rounded-2xl px-4 py-5 text-center ${justNow(M + 1) ? 'animate-rise-in' : ''}`}>
            {justNow(M + 1) && data.pointsGained > 0 && <Confetti tier="legendary" />}
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <Sparkles className="size-3.5 text-points" aria-hidden />
              Points won
            </p>
            <p className="text-glow mt-1 font-mono text-4xl font-bold tabular-nums text-points">
              +{pointsValue}
            </p>
            {data.favoriteItems.length > 0 && (
              <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-left">
                {data.favoriteItems.map((it, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    {it.kind === 'player' ? (
                      <Star className="size-4 shrink-0 text-points" aria-hidden />
                    ) : (
                      <Shield className="size-4 shrink-0 text-primary-bright" aria-hidden />
                    )}
                    <span className="min-w-0 flex-1 truncate text-muted">
                      <span className="font-semibold text-foreground">{it.label}</span>
                      <span className="text-subtle"> · {it.detail}</span>
                    </span>
                    <span
                      className={`shrink-0 text-right font-mono text-sm font-bold tabular-nums ${
                        it.points >= 0 ? 'text-points' : 'text-danger'
                      }`}
                    >
                      {it.points >= 0 ? `+${it.points}` : it.points}
                      <span className="ml-0.5 text-[0.65rem] font-medium opacity-80">pts</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* M+2 — coins cascade */}
        {shown(M + 2) && (
          <div className={`glass rounded-2xl px-4 py-4 ${justNow(M + 2) ? 'animate-rise-in' : ''}`}>
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

        {/* M+3 — leaderboard FLIP */}
        {shown(M + 3) && (
          <div className={`glass rounded-2xl px-4 py-4 ${justNow(M + 3) ? 'animate-rise-in' : ''}`}>
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

        {/* M+4 — shop CTA */}
        {shown(M + 4) && (
          <div className={`glass-strong rounded-2xl px-4 py-5 text-center ${justNow(M + 4) ? 'animate-rise-in' : ''}`}>
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
              Then — on to the next one
            </p>
            {doneAction ? (
              <form action={doneAction}>
                <Button type="submit" variant="primary" size="lg" className="w-full">
                  Next match day
                  <ArrowRight className="size-5" aria-hidden />
                </Button>
              </form>
            ) : (
              <Button asChild variant="primary" size="lg" className="w-full">
                <Link href="/today">
                  Next match day
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
