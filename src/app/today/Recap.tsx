'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Coins, Sparkles, Trophy, ChevronRight, FastForward, ArrowUp, ArrowDown, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { Flag } from '@/components/ui/flag';

// ─── data shapes (computed server-side over the slate's bets + ledger) ──────────

export interface RecapPick {
  label: string; // e.g. "Outcome", "Score", "First scorer"
  detail: string; // e.g. "Brazil", "2–1", "L. Messi"
  result: 'won' | 'lost' | 'void';
  staked: number; // Coins staked on this bet (0 if none)
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
}

export interface RecapCoinItem {
  label: string;
  amount: number; // signed
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
  slateLabel: string;
  matches: RecapMatch[];
  pointsGained: number;
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

function Confetti({ run }: { run: boolean }) {
  if (!run) return null;
  const colors = ['var(--color-points)', 'var(--color-success)', 'var(--color-primary-bright)', 'var(--color-accent)'];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-visible">
      {Array.from({ length: 16 }).map((_, i) => {
        const angle = (i / 16) * Math.PI * 2;
        const dist = 40 + (i % 4) * 16;
        const style: React.CSSProperties = {
          left: '50%',
          top: '40%',
          background: colors[i % colors.length],
          ['--cx' as string]: `${Math.cos(angle) * dist}px`,
          ['--cy' as string]: `${Math.sin(angle) * dist + 30}px`,
          ['--cr' as string]: `${(i % 2 ? 1 : -1) * 220}deg`,
          animationDelay: `${(i % 5) * 30}ms`,
        };
        return <span key={i} className="confetti-piece absolute size-1.5 rounded-[1px]" style={style} />;
      })}
    </div>
  );
}

const RESULT_STYLE = {
  won: { color: 'text-success', Icon: CheckCircle2, tag: 'HIT' },
  lost: { color: 'text-danger', Icon: XCircle, tag: 'MISS' },
  void: { color: 'text-subtle', Icon: MinusCircle, tag: 'VOID' },
} as const;

// ─── the recap ────────────────────────────────────────────────────────────────

export function Recap({ data }: { data: RecapData }) {
  const reduced = useReducedMotion();
  const M = data.matches.length;
  // scene indices: 0 title · 1..M matches · M+1 points · M+2 coins · M+3 board · M+4 cta
  const TOTAL = M + 5;
  const lastScene = TOTAL - 1;

  // Reduced motion is known on first render (useSyncExternalStore), so start straight
  // at the full static end-state; otherwise begin at the title and auto-advance.
  const [step, setStep] = useState(() => (reduced ? lastScene : 0));

  useEffect(() => {
    if (reduced || step >= lastScene) return;
    const t = setTimeout(() => setStep(s => Math.min(lastScene, s + 1)), 1500);
    return () => clearTimeout(t);
  }, [step, reduced, lastScene]);

  const advance = () => setStep(s => Math.min(lastScene, s + 1));
  const skip = () => setStep(lastScene);

  const shown = (scene: number) => step >= scene;
  const justNow = (scene: number) => step === scene && !reduced; // first frame of a scene

  const pointsValue = useCountUp(data.pointsGained, shown(M + 1), reduced);
  const coinsValue = useCountUp(Math.abs(data.coinsGained), shown(M + 2), reduced);

  const boardAfter = [...data.standings].sort((a, b) => a.rankAfter - b.rankAfter);

  return (
    <div
      onClick={advance}
      className="relative select-none"
      role="region"
      aria-label="Morning recap"
    >
      {step < lastScene && (
        <button
          type="button"
          onClick={e => {
            e.stopPropagation();
            skip();
          }}
          className="absolute -top-1 right-0 z-10 inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-3 py-1 text-xs font-semibold text-muted transition-colors hover:text-foreground"
        >
          <FastForward className="size-3" aria-hidden />
          Skip
        </button>
      )}

      <div className="space-y-4">
        {/* 0 — title */}
        {shown(0) && (
          <div className={`text-center ${justNow(0) ? 'animate-rise-in' : ''}`}>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-subtle">Last night</p>
            <h1 className="text-glow mt-1 font-display text-3xl font-bold tracking-tight text-foreground">
              {data.slateLabel}
            </h1>
          </div>
        )}

        {/* 1..M — match-by-match */}
        {data.matches.map((m, i) => {
          const scene = i + 1;
          if (!shown(scene)) return null;
          const anyHit = m.picks.some(p => p.result === 'won');
          return (
            <div
              key={m.id}
              className={`glass relative overflow-hidden rounded-2xl px-4 py-3.5 ${justNow(scene) ? 'animate-rise-in' : ''}`}
            >
              {justNow(scene) && anyHit && <Confetti run />}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <span className="flex min-w-0 items-center justify-end gap-2 font-display font-semibold text-foreground">
                  <span className="truncate">{m.home}</span>
                  <Flag name={m.home} countryCode={m.homeCode} size="sm" />
                </span>
                <span className="rounded-lg bg-surface-3 px-2.5 py-1 font-mono text-lg font-bold tabular-nums text-foreground">
                  {m.homeScore}<span className="px-1 text-subtle">–</span>{m.awayScore}
                </span>
                <span className="flex min-w-0 items-center gap-2 font-display font-semibold text-foreground">
                  <Flag name={m.away} countryCode={m.awayCode} size="sm" />
                  <span className="truncate">{m.away}</span>
                </span>
              </div>
              <div className="mt-3 space-y-1.5">
                {m.picks.length === 0 && (
                  <p className="text-center text-xs text-subtle">No bets on this match.</p>
                )}
                {m.picks.map((p, j) => {
                  const s = RESULT_STYLE[p.result];
                  return (
                    <div
                      key={j}
                      className={`flex items-center justify-between gap-2 text-sm ${justNow(scene) ? (p.result === 'won' ? 'animate-hit-pop' : p.result === 'lost' ? 'animate-miss-shake' : '') : ''}`}
                    >
                      <span className="min-w-0 truncate text-muted">
                        <span className="text-subtle">{p.label}:</span> {p.detail}
                        {p.staked > 0 && (
                          <span className="ml-1.5 inline-flex items-center gap-0.5 text-points">
                            <Coins className="size-3" aria-hidden />
                            {p.staked}¢
                          </span>
                        )}
                      </span>
                      <span className={`inline-flex shrink-0 items-center gap-1 font-bold ${s.color}`}>
                        <s.Icon className="size-4" aria-hidden />
                        {s.tag}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* M+1 — points odometer */}
        {shown(M + 1) && (
          <div className={`glass-strong relative overflow-hidden rounded-2xl px-4 py-5 text-center ${justNow(M + 1) ? 'animate-rise-in' : ''}`}>
            {justNow(M + 1) && data.pointsGained > 0 && <Confetti run />}
            <p className="flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
              <Sparkles className="size-3.5 text-points" aria-hidden />
              Points won
            </p>
            <p className="text-glow mt-1 font-mono text-4xl font-bold tabular-nums text-points">
              +{pointsValue}
            </p>
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

      {step < lastScene && (
        <p className="mt-4 flex items-center justify-center gap-1 text-xs text-subtle">
          Tap to continue <ChevronRight className="size-3.5" aria-hidden />
        </p>
      )}
    </div>
  );
}
