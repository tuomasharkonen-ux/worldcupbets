'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Star,
  Search,
  ArrowRight,
  ArrowLeft,
  Lock,
  Check,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Flag } from '@/components/ui/flag';
import type { LadderBreakdown } from '@/settlement/favorites';
import { completeOnboarding } from './actions';

export interface PickerTeam {
  id: string;
  name: string;
  countryCode: string;
  breakdown: LadderBreakdown | null;
}

export interface PickerPlayer {
  id: string;
  teamId: string;
  name: string;
  position: string | null;
  number: number | null;
}

// Ladder rungs come back as reach-rungs + third + champion; show them in true
// bracket order with 3rd place slotted before the final.
const RUNG_ORDER = ['r32', 'r16', 'qf', 'sf', 'third', 'final', 'champion'];

type Step = 'team' | 'player';

export function OnboardingPicker({ teams, players }: { teams: PickerTeam[]; players: PickerPlayer[] }) {
  const [step, setStep] = useState<Step>('team');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [isPending, startTransition] = useTransition();

  const team = useMemo(() => teams.find(t => t.id === teamId) ?? null, [teams, teamId]);
  const squad = useMemo(
    () => players.filter(p => p.teamId === teamId),
    [players, teamId],
  );
  const filteredSquad = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? squad.filter(p => p.name.toLowerCase().includes(q)) : squad;
  }, [squad, query]);
  const player = useMemo(() => squad.find(p => p.id === playerId) ?? null, [squad, playerId]);

  function submit() {
    if (!teamId || !playerId) return;
    startTransition(async () => {
      await completeOnboarding(teamId, playerId);
    });
  }

  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
      <header className="space-y-2 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-3xl bg-primary text-on-primary shadow-[0_5px_0_0_var(--color-primary-press)]">
          <Sparkles className="size-7" aria-hidden />
        </span>
        <h1 className="text-glow font-display text-3xl font-bold tracking-tight text-foreground">
          {step === 'team' ? 'Back your champion' : 'Pick your favorite player'}
        </h1>
        <p className="text-sm text-muted">
          {step === 'team'
            ? 'Call the winner of the whole tournament. Deeper runs — and bolder picks — pay more. Locked for the tournament.'
            : `One ${team?.name ?? ''} player to follow all summer. Points for every goal, a small ding if they’re booked.`}
        </p>
      </header>

      <Steps step={step} />

      {step === 'team' ? (
        <>
          <div className="max-h-[24rem] overflow-y-auto pr-1 sm:max-h-[28rem]">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {teams.map(t => {
                const selected = t.id === teamId;
                const mult = t.breakdown?.multiplier ?? 1;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTeamId(t.id)}
                    aria-pressed={selected}
                    className={`glass flex items-center gap-2 rounded-xl px-3 py-2 text-left transition-[transform,border-color] duration-150 hover:-translate-y-0.5 ${
                      selected
                        ? 'border-points ring-2 ring-points shadow-[0_0_0_4px_color-mix(in_oklab,var(--color-points)_22%,transparent)]'
                        : 'hover:border-border-strong'
                    }`}
                  >
                    <Flag name={t.name} countryCode={t.countryCode} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-display text-sm font-semibold text-foreground">
                      {t.name}
                    </span>
                    {mult > 1 && (
                      <Badge variant="points" size="sm" className="shrink-0">×{mult}</Badge>
                    )}
                    {selected && <Check className="size-4 shrink-0 text-points" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>

          {team?.breakdown && (
            <LadderCard team={team} />
          )}

          <Button
            type="button"
            size="lg"
            variant="primary"
            className="w-full"
            disabled={!teamId}
            onClick={() => setStep('player')}
          >
            Choose your player
            <ArrowRight className="size-5" aria-hidden />
          </Button>
        </>
      ) : (
        <>
          <Card variant="glass" padding="md" className="flex items-center gap-3">
            <Flag name={team!.name} countryCode={team!.countryCode} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="font-display font-semibold text-foreground">{team!.name}</p>
              <p className="text-xs text-muted">
                Backed for the title · 🏆 {team!.breakdown?.championTotal ?? '—'} pts if they win
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setStep('team')}>
              <ArrowLeft className="size-4" aria-hidden />
              Change
            </Button>
          </Card>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
            <Input
              type="search"
              placeholder="Search the squad…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
            {filteredSquad.map(p => {
              const selected = p.id === playerId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPlayerId(p.id)}
                  aria-pressed={selected}
                  className={`glass flex w-full items-center gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-[border-color] ${
                    selected ? 'border-[var(--color-primary-bright)] ring-2 ring-[var(--color-primary-bright)]' : 'hover:border-border-strong'
                  }`}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-surface-2 font-mono text-xs text-muted">
                    {p.number ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display font-semibold text-foreground">{p.name}</span>
                    {p.position && <span className="block text-xs text-subtle">{p.position}</span>}
                  </span>
                  {selected ? (
                    <Star className="size-5 shrink-0 fill-points text-points" aria-hidden />
                  ) : (
                    <Star className="size-5 shrink-0 text-subtle" aria-hidden />
                  )}
                </button>
              );
            })}
            {filteredSquad.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No players match “{query}”.</p>
            )}
          </div>

          {player && (
            <Card variant="glass" padding="md" className="space-y-1 text-center">
              <p className="text-sm text-muted">You’re all set</p>
              <p className="font-display text-foreground">
                <span className="font-bold">{player.name}</span> is your favorite player, and{' '}
                <span className="font-bold">{team!.name}</span> is your pick to win it all.
              </p>
              <p className="text-xs text-subtle">Both are locked for the whole tournament.</p>
            </Card>
          )}

          <Button
            type="button"
            size="lg"
            variant="points"
            className="w-full"
            disabled={!playerId || isPending}
            onClick={submit}
          >
            <Lock className="size-5" aria-hidden />
            {isPending ? 'Locking in…' : 'Lock it in'}
          </Button>
        </>
      )}
    </main>
  );
}

function LadderCard({ team }: { team: PickerTeam }) {
  const b = team.breakdown!;
  const rungs = [...b.rungs].sort((a, c) => RUNG_ORDER.indexOf(a.key) - RUNG_ORDER.indexOf(c.key));
  return (
    <Card variant="well" padding="md" className="space-y-3">
      <div className="flex items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag name={team.name} countryCode={team.countryCode} size="md" />
          {team.name} — your rewards
        </CardTitle>
        {b.multiplier > 1 && (
          <Badge variant="points" size="sm" className="gap-0.5">
            <TrendingUp className="size-3" aria-hidden />×{b.multiplier} underdog
          </Badge>
        )}
      </div>
      <ul className="space-y-1">
        {rungs.map(r => (
          <li
            key={r.key}
            className={`flex items-center justify-between text-sm ${
              r.key === 'champion' ? 'font-semibold text-points' : 'text-muted'
            }`}
          >
            <span>{r.label}</span>
            <span className="font-mono">+{r.points} pts</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border pt-2 text-xs text-subtle">
        Milestones bank as your team advances — you don’t have to wait for the final.
      </p>
    </Card>
  );
}

function Steps({ step }: { step: Step }) {
  return (
    <div className="flex items-center justify-center gap-2 text-xs font-medium text-subtle">
      <span className={step === 'team' ? 'text-primary-bright' : 'text-success'}>1 · Champion</span>
      <span className="h-px w-6 bg-border" aria-hidden />
      <span className={step === 'player' ? 'text-primary-bright' : ''}>2 · Player</span>
    </div>
  );
}
