'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Crown,
  Lock,
  Medal,
  Minus,
  Pencil,
  Plus,
  Search,
  Target,
  Trophy,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import { InfoTip } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Countdown } from '@/components/Countdown';
import { ShareBetsButton } from '@/app/today/ShareBetsButton';
import { buildGoldenBracketShareText } from '@/lib/share';
import type { GbTeamOption, GbScorerOption } from '@/lib/golden-bracket';
import type { GoldenBracketConfig } from '@/types/db';
import { submitGoldenBracket, type GoldenBracketPayload } from './actions';

export type GbStep = 'bracket' | 'scorer' | 'review';

type Slot = 'champion' | 'runnerUp' | 'third' | 'fourth';

const SLOTS: {
  slot: Slot;
  label: string;
  pointsKey: 'champion' | 'runner_up' | 'third' | 'fourth';
  Icon: typeof Crown;
}[] = [
  { slot: 'champion', label: 'Champion', pointsKey: 'champion', Icon: Crown },
  { slot: 'runnerUp', label: 'Runner-up', pointsKey: 'runner_up', Icon: Trophy },
  { slot: 'third', label: 'Third place', pointsKey: 'third', Icon: Medal },
  { slot: 'fourth', label: 'Fourth place', pointsKey: 'fourth', Icon: Medal },
];

const ERROR_COPY: Record<string, string> = {
  closed: 'The Golden Bracket isn’t open right now.',
  locked: 'The bracket locked at the first quarter-final kickoff.',
  teams: 'Pick four different quarter-finalists — one per placement.',
  scorer: 'That player isn’t on a remaining squad.',
  goals: 'The goal tally must be between 1 and 30.',
  server: 'Something went wrong saving your bracket. Try again.',
};

export interface GoldenBracketFlowProps {
  teams: GbTeamOption[];
  scorers: GbScorerOption[];
  cfg: GoldenBracketConfig;
  myPick: GoldenBracketPayload | null;
  lockAt: string;
  locked: boolean;
  error?: string | null;
  /** Admin-preview overrides: stubbed action + a fixed starting screen. */
  submitAction?: (payload: GoldenBracketPayload) => Promise<void>;
  initialStep?: GbStep | 'summary';
}

export function GoldenBracketFlow({
  teams,
  scorers,
  cfg,
  myPick,
  lockAt,
  locked,
  error,
  submitAction,
  initialStep,
}: GoldenBracketFlowProps) {
  const startInSummary = initialStep === 'summary' || (initialStep == null && (myPick != null || locked));
  const [inWizard, setInWizard] = useState(!startInSummary);
  const [step, setStep] = useState<GbStep>(initialStep && initialStep !== 'summary' ? initialStep : 'bracket');
  const [picks, setPicks] = useState<Record<Slot, string | null>>({
    champion: myPick?.champion ?? null,
    runnerUp: myPick?.runnerUp ?? null,
    third: myPick?.third ?? null,
    fourth: myPick?.fourth ?? null,
  });
  const [scorerId, setScorerId] = useState<string | null>(myPick?.scorerId ?? null);
  const [scorerGoals, setScorerGoals] = useState<number | null>(myPick?.scorerGoals ?? null);
  const [openSlot, setOpenSlot] = useState<Slot | null>(null);
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const teamById = useMemo(() => new Map(teams.map(t => [t.id, t])), [teams]);
  const scorer = useMemo(() => scorers.find(s => s.id === scorerId) ?? null, [scorers, scorerId]);
  const filteredScorers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q) return scorers.filter(s => s.name.toLowerCase().includes(q));
    // No search: just the current top 6 by goals. The pick is kept visible if it sits outside.
    const top = scorers.slice(0, 6);
    if (scorerId && !top.some(s => s.id === scorerId)) {
      const picked = scorers.find(s => s.id === scorerId);
      if (picked) return [...top, picked];
    }
    return top;
  }, [scorers, query, scorerId]);
  const bracketComplete = SLOTS.every(({ slot }) => picks[slot] != null);
  const minGoals = Math.max(scorer?.goals ?? 0, 1);

  // Total if every line hits: each exact placement at its team's multiplier, plus
  // the scorer and the exact-tally bonus.
  const perfectTotal = useMemo(() => {
    let total = cfg.scorer_player + cfg.scorer_exact;
    for (const { slot, pointsKey } of SLOTS) {
      const t = picks[slot] ? teamById.get(picks[slot]!) : null;
      total += t?.points[pointsKey] ?? 0;
    }
    return total;
  }, [picks, teamById, cfg]);

  const shareText = useMemo(
    () =>
      buildGoldenBracketShareText(
        SLOTS.map(({ slot }) => {
          const t = picks[slot] ? teamById.get(picks[slot]!) : null;
          return t ? { name: t.name, country_code: t.country_code } : null;
        }),
        scorer && scorerGoals != null ? { name: scorer.name, goals: scorerGoals } : null,
      ),
    [picks, teamById, scorer, scorerGoals],
  );

  function selectTeam(slot: Slot, teamId: string) {
    setPicks(prev => {
      const next = { ...prev };
      // Picking a team that already holds another slot swaps the two slots.
      const holder = SLOTS.find(s => prev[s.slot] === teamId)?.slot;
      if (holder && holder !== slot) next[holder] = prev[slot];
      next[slot] = teamId;
      return next;
    });
    setOpenSlot(null);
  }

  function pickScorer(id: string) {
    setScorerId(id);
    const picked = scorers.find(s => s.id === id);
    // Default tally: two more than they already have (tallies can only grow).
    setScorerGoals(Math.max((picked?.goals ?? 0) + 2, 1));
  }

  function submit() {
    if (!bracketComplete || !scorerId || scorerGoals == null) return;
    const payload: GoldenBracketPayload = {
      champion: picks.champion!,
      runnerUp: picks.runnerUp!,
      third: picks.third!,
      fourth: picks.fourth!,
      scorerId,
      scorerGoals,
    };
    startTransition(async () => {
      await (submitAction ?? submitGoldenBracket)(payload);
      setInWizard(false);
    });
  }

  const errorCopy = error ? ERROR_COPY[error] ?? ERROR_COPY.server : null;

  // ─── locked without a bracket: nothing to do here ─────────────────────────────
  if (locked && !myPick) {
    return (
      <Card variant="glass" padding="lg" className="space-y-2 text-center">
        <Lock className="mx-auto size-8 text-subtle" aria-hidden />
        <p className="font-display text-lg font-bold text-foreground">The Golden Bracket is locked</p>
        <p className="text-sm text-muted">
          It closed at the first quarter-final kickoff. Follow everyone else’s brackets from the leaderboard as
          the bracket plays out.
        </p>
      </Card>
    );
  }

  // ─── summary (submitted / locked) ─────────────────────────────────────────────
  if (!inWizard) {
    return (
      <div className="space-y-5">
        {errorCopy && <ErrorBanner copy={errorCopy} />}
        <header className="space-y-2 text-center">
          <GoldenBadge />
          <h1 className="text-glow font-display text-3xl font-bold tracking-tight text-foreground">
            Your Golden Bracket
          </h1>
          <p className="text-sm text-muted">
            {locked
              ? 'Locked for the run-in — Points land when the tournament wraps.'
              : 'Bracket’s in. You can edit it until the first quarter-final kicks off.'}
          </p>
        </header>
        {locked ? (
          <Badge variant="locked" className="mx-auto flex w-fit">Locked</Badge>
        ) : (
          <Countdown target={lockAt} label="Locks in" liveLabel="Locked" />
        )}

        <Slip
          picks={picks}
          teamById={teamById}
          scorer={scorer}
          scorerGoals={scorerGoals}
          cfg={cfg}
          perfectTotal={perfectTotal}
        />

        <ShareBetsButton text={shareText} label="Share my bracket" />

        {locked ? (
          <Button asChild size="lg" variant="glass" className="w-full">
            <Link href="/today">
              Back to Today
              <ArrowRight className="size-5" aria-hidden />
            </Link>
          </Button>
        ) : (
          <>
            {/* The forward step: the bracket is a side bet — send them on to the day's slate. */}
            <Button asChild size="lg" variant="primary" className="w-full">
              <Link href="/today">
                Place your match bets
                <ArrowRight className="size-5" aria-hidden />
              </Link>
            </Button>
            <Button
              type="button"
              size="lg"
              variant="glass"
              className="w-full"
              onClick={() => {
                setInWizard(true);
                setStep('bracket');
              }}
            >
              <Pencil className="size-4" aria-hidden />
              Edit your bracket
            </Button>
          </>
        )}
      </div>
    );
  }

  // ─── wizard ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {errorCopy && <ErrorBanner copy={errorCopy} />}
      <header className="space-y-2 text-center">
        <GoldenBadge />
        <h1 className="text-glow font-display text-3xl font-bold tracking-tight text-foreground">
          {step === 'bracket' && 'Call the top four'}
          {step === 'scorer' && 'Call the top scorer'}
          {step === 'review' && 'Your golden slip'}
        </h1>
        <Countdown target={lockAt} label="Locks in" liveLabel="Locked" />
      </header>

      <Steps step={step} />

      {step === 'bracket' && (
        <>
          <div className="space-y-2.5">
            {SLOTS.map(({ slot, label, pointsKey, Icon }) => {
              const picked = picks[slot] ? teamById.get(picks[slot]!) : null;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setOpenSlot(slot)}
                  aria-haspopup="dialog"
                  className={`glass flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-[border-color] hover:border-border-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)] ${
                    picked ? 'border-points ring-1 ring-points' : ''
                  }`}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-points">
                    <Icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-subtle">{label}</span>
                    {picked ? (
                      <span className="flex items-center gap-2">
                        <Flag name={picked.name} countryCode={picked.country_code} size="sm" />
                        <span className="truncate font-display font-semibold text-foreground">{picked.name}</span>
                      </span>
                    ) : (
                      <span className="font-display text-muted">Pick a team…</span>
                    )}
                  </span>
                  {picked && (
                    <span className="shrink-0 text-right">
                      <span className="block font-mono text-sm font-semibold text-points">
                        +{picked.points[pointsKey]} pts
                      </span>
                      {picked.mult > 1 && (
                        <span className="block text-[11px] text-subtle">×{picked.mult} underdog</span>
                      )}
                    </span>
                  )}
                  <ChevronDown className="size-5 shrink-0 text-subtle" aria-hidden />
                </button>
              );
            })}
          </div>
          <p className="text-center text-xs text-subtle">
            Four different teams — picking one that’s already placed swaps the two spots.
          </p>
          <Button
            type="button"
            size="lg"
            variant="primary"
            className="w-full"
            disabled={!bracketComplete}
            onClick={() => setStep('scorer')}
          >
            Choose the top scorer
            <ArrowRight className="size-5" aria-hidden />
          </Button>

          <Dialog open={openSlot != null} onOpenChange={open => !open && setOpenSlot(null)}>
            <DialogContent className="gap-0" showClose onOpenAutoFocus={e => e.preventDefault()}>
              <DialogTitle>{SLOTS.find(s => s.slot === openSlot)?.label}</DialogTitle>
              <DialogDescription className="mt-1">
                Longer odds, bigger multiplier — every placement Point scales with it.
              </DialogDescription>
              <div className="-mr-2 mt-4 flex-1 space-y-1 overflow-y-auto pr-2">
                {openSlot != null &&
                  teams.map(t => {
                    const selected = picks[openSlot] === t.id;
                    const heldBy = SLOTS.find(s => picks[s.slot] === t.id && s.slot !== openSlot);
                    const pointsKey = SLOTS.find(s => s.slot === openSlot)!.pointsKey;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => selectTeam(openSlot, t.id)}
                        aria-pressed={selected}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)] ${
                          selected ? 'bg-surface-2' : ''
                        }`}
                      >
                        <Flag name={t.name} countryCode={t.country_code} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-display text-sm font-semibold text-foreground">
                            {t.name}
                          </span>
                          {heldBy && (
                            <span className="block text-[11px] text-subtle">
                              now {SLOTS.find(s => s.slot === heldBy.slot)!.label.toLowerCase()} — will swap
                            </span>
                          )}
                        </span>
                        {t.mult > 1 && (
                          <Badge variant="points" size="sm" className="shrink-0">×{t.mult}</Badge>
                        )}
                        <span className="shrink-0 text-right font-mono text-xs">
                          <span className="block font-semibold text-points">+{t.points[pointsKey]}</span>
                          <span className="block text-subtle">top-4 +{t.points.consolation}</span>
                        </span>
                        {selected && <Check className="size-4 shrink-0 text-points" aria-hidden />}
                      </button>
                    );
                  })}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {step === 'scorer' && (
        <>
          <div className="flex items-center justify-center gap-1 text-xs text-subtle">
            <span>Every player on the eight remaining squads is fair game.</span>
            <InfoTip label="How the top-scorer line settles">
              Your pick pays if they end the tournament tied-or-sole top scorer by goals — penalties count, own
              goals don’t. Mind that the tally they must beat includes players already knocked out.
            </InfoTip>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              type="search"
              placeholder="Search any player…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Search any player"
            />
          </div>
          <div className="space-y-1.5">
            {filteredScorers.map(p => {
              const selected = p.id === scorerId;
              const t = teamById.get(p.teamId);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pickScorer(p.id)}
                  aria-pressed={selected}
                  className={`glass flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-[border-color] ${
                    selected ? 'border-points ring-2 ring-points' : 'hover:border-border-strong'
                  }`}
                >
                  {t && <Flag name={t.name} countryCode={t.country_code} size="sm" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display font-semibold text-foreground">{p.name}</span>
                    <span className="block text-xs text-subtle">
                      {p.position ?? '—'}
                      {p.availability === 'out' && ' · ruled out'}
                    </span>
                  </span>
                  {p.goals > 0 && (
                    <Badge variant="points" size="sm" className="shrink-0">
                      {p.goals} {p.goals === 1 ? 'goal' : 'goals'} · {p.apps} {p.apps === 1 ? 'app' : 'apps'}
                    </Badge>
                  )}
                  {selected && <Check className="size-5 shrink-0 text-points" aria-hidden />}
                </button>
              );
            })}
            {filteredScorers.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No players match “{query}”.</p>
            )}
          </div>

          {scorer && scorerGoals != null && (
            <Card variant="well" padding="md" className="space-y-2">
              <CardTitle className="text-base">Final goal tally for {scorer.name}</CardTitle>
              <div className="flex items-center justify-center gap-4">
                <Button
                  type="button"
                  variant="glass"
                  size="icon"
                  aria-label="One goal fewer"
                  disabled={scorerGoals <= minGoals}
                  onClick={() => setScorerGoals(g => Math.max((g ?? minGoals) - 1, minGoals))}
                >
                  <Minus className="size-4" aria-hidden />
                </Button>
                <span className="w-20 text-center font-mono text-3xl font-bold tabular-nums text-foreground">
                  {scorerGoals}
                </span>
                <Button
                  type="button"
                  variant="glass"
                  size="icon"
                  aria-label="One goal more"
                  disabled={scorerGoals >= 30}
                  onClick={() => setScorerGoals(g => Math.min((g ?? minGoals) + 1, 30))}
                >
                  <Plus className="size-4" aria-hidden />
                </Button>
              </div>
              <p className="text-center text-xs text-subtle">
                They’re on {scorer.goals} now — exact tally pays +{cfg.scorer_exact}, one off +{cfg.scorer_close}.
              </p>
            </Card>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep('bracket')}>
              <ArrowLeft className="size-5" aria-hidden />
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              variant="primary"
              className="flex-1"
              disabled={!scorerId || scorerGoals == null}
              onClick={() => setStep('review')}
            >
              Review your slip
              <ArrowRight className="size-5" aria-hidden />
            </Button>
          </div>
        </>
      )}

      {step === 'review' && (
        <>
          <Slip
            picks={picks}
            teamById={teamById}
            scorer={scorer}
            scorerGoals={scorerGoals}
            cfg={cfg}
            perfectTotal={perfectTotal}
          />
          <p className="text-center text-xs text-subtle">
            Free bet — Points only, no Coins staked. Settles once the tournament is done.
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep('scorer')}>
              <ArrowLeft className="size-5" aria-hidden />
              Back
            </Button>
            <Button
              type="button"
              size="lg"
              variant="points"
              className="flex-1"
              disabled={isPending}
              onClick={submit}
            >
              <Lock className="size-5" aria-hidden />
              {isPending ? 'Saving…' : myPick ? 'Save changes' : 'Place the bet'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── pieces ───────────────────────────────────────────────────────────────────────

function GoldenBadge() {
  return (
    <span className="mx-auto grid size-14 place-items-center rounded-3xl bg-points text-[#0a1e12] shadow-[0_5px_0_0_var(--color-points-press)]">
      <Trophy className="size-7" aria-hidden />
    </span>
  );
}

function ErrorBanner({ copy }: { copy: string }) {
  return (
    <Card variant="solid" padding="sm" className="border-danger/40 text-center text-sm text-danger">
      {copy}
    </Card>
  );
}

function Steps({ step }: { step: GbStep }) {
  const idx = ['bracket', 'scorer', 'review'].indexOf(step);
  return (
    <div className="flex items-center justify-center gap-2 text-xs font-medium text-subtle">
      <span className={step === 'bracket' ? 'text-primary-bright' : idx > 0 ? 'text-success' : ''}>1 · Top four</span>
      <span className="h-px w-6 bg-border" aria-hidden />
      <span className={step === 'scorer' ? 'text-primary-bright' : idx > 1 ? 'text-success' : ''}>2 · Scorer</span>
      <span className="h-px w-6 bg-border" aria-hidden />
      <span className={step === 'review' ? 'text-primary-bright' : ''}>3 · Slip</span>
    </div>
  );
}

// The slip: shared by the review step and the submitted/locked summary so what you
// confirm is exactly what you'll see afterwards.
function Slip({
  picks,
  teamById,
  scorer,
  scorerGoals,
  cfg,
  perfectTotal,
}: {
  picks: Record<Slot, string | null>;
  teamById: Map<string, GbTeamOption>;
  scorer: GbScorerOption | null;
  scorerGoals: number | null;
  cfg: GoldenBracketConfig;
  perfectTotal: number;
}) {
  return (
    <Card variant="glass" padding="md" className="space-y-3">
      <ul className="space-y-2.5">
        {SLOTS.map(({ slot, label, pointsKey, Icon }) => {
          const t = picks[slot] ? teamById.get(picks[slot]!) : null;
          if (!t) return null;
          return (
            <li key={slot} className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-points">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-subtle">{label}</span>
                <span className="flex items-center gap-2">
                  <Flag name={t.name} countryCode={t.country_code} size="sm" />
                  <span className="truncate font-display font-semibold text-foreground">{t.name}</span>
                  {t.mult > 1 && <Badge variant="points" size="sm">×{t.mult}</Badge>}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-xs">
                <span className="block font-semibold text-points">+{t.points[pointsKey]}</span>
                <span className="block text-subtle">top-4 +{t.points.consolation}</span>
              </span>
            </li>
          );
        })}
        {scorer && (
          <li className="flex items-center gap-3 border-t border-border pt-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2 text-points">
              <Target className="size-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs text-subtle">Top scorer · {scorerGoals} goals</span>
              <span className="block truncate font-display font-semibold text-foreground">{scorer.name}</span>
            </span>
            <span className="shrink-0 text-right font-mono text-xs">
              <span className="block font-semibold text-points">+{cfg.scorer_player}</span>
              <span className="block text-subtle">
                tally +{cfg.scorer_exact} / ±1 +{cfg.scorer_close}
              </span>
            </span>
          </li>
        )}
      </ul>
      <p className="flex items-center justify-between border-t border-border pt-2.5 text-sm">
        <span className="text-muted">If every line hits</span>
        <span className="font-mono font-bold text-points">+{perfectTotal} pts</span>
      </p>
    </Card>
  );
}
