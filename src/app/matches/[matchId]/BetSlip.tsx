'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Lock, Save } from 'lucide-react';
import { submitBet, type BetSlipState } from './actions';
import { PropSlot, type PropType, type SlipSquads } from './PropSlot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Flag } from '@/components/ui/flag';

export type { SlipSquads, SlipPlayer } from './PropSlot';

function SubmitButton({ disabled, incomplete }: { disabled: boolean; incomplete: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || disabled} className="w-full">
      {pending ? (
        <>
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : disabled && !incomplete ? (
        <>
          <Lock className="size-5" aria-hidden />
          Locked
        </>
      ) : (
        <>
          <Save className="size-5" aria-hidden />
          Save bets
        </>
      )}
    </Button>
  );
}

interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  locked: boolean;
  squads: SlipSquads | null;
  existing: {
    outcome?: 'home' | 'draw' | 'away';
    exactScore?: { home: number; away: number };
    propSlot?: { type: PropType; playerId: string } | null;
  };
}

export function BetSlip({ matchId, homeTeam, awayTeam, locked, squads, existing }: Props) {
  const boundAction = submitBet.bind(null, matchId);
  const [state, formAction] = useActionState<BetSlipState, FormData>(boundAction, {});

  // Core bets are mandatory — track them so we can gate the submit button.
  const [outcome, setOutcome] = useState<string>(existing.outcome ?? '');
  const [homeScore, setHomeScore] = useState<string>(existing.exactScore?.home?.toString() ?? '');
  const [awayScore, setAwayScore] = useState<string>(existing.exactScore?.away?.toString() ?? '');

  const coreComplete = outcome !== '' && homeScore !== '' && awayScore !== '';

  return (
    <form action={formAction} className="space-y-6">
      {state.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-[color-mix(in_oklab,var(--color-danger)_14%,transparent)] px-3 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}
      {state.success && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-xl border border-success/30 bg-[color-mix(in_oklab,var(--color-success)_14%,transparent)] px-3 py-2.5 text-sm text-success"
        >
          <CheckCircle2 className="size-4 shrink-0" aria-hidden />
          <span>Bets saved.</span>
        </div>
      )}

      {/* Outcome — required */}
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium text-muted">Match outcome</legend>
        <div className="grid grid-cols-3 gap-2.5">
          {(['home', 'draw', 'away'] as const).map(opt => {
            const label = opt === 'home' ? homeTeam : opt === 'away' ? awayTeam : 'Draw';
            return (
              <label
                key={opt}
                className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border bg-surface-2 px-3 py-4 text-center font-display text-sm font-semibold leading-tight text-foreground transition-[transform,border-color,background-color,box-shadow]
                  border-border hover:border-border-strong
                  has-[:checked]:-translate-y-0.5 has-[:checked]:border-[var(--color-primary-bright)] has-[:checked]:bg-[color-mix(in_oklab,var(--color-primary-bright)_18%,transparent)] has-[:checked]:shadow-[0_4px_0_0_var(--color-primary-press)]
                  has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--color-primary-bright)]
                  ${locked ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name="outcome"
                  value={opt}
                  disabled={locked}
                  checked={outcome === opt}
                  onChange={e => setOutcome(e.target.value)}
                  className="sr-only"
                />
                {opt !== 'draw' && <Flag name={label} size="md" className="mb-1.5" />}
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Exact score — required */}
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium text-muted">
          Exact score <span className="font-normal text-points">(+15 pts bonus if exact)</span>
        </legend>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="home_score" className="flex items-center gap-1.5 truncate text-xs text-subtle">
              <Flag name={homeTeam} size="sm" />
              <span className="truncate">{homeTeam}</span>
            </label>
            <Input
              id="home_score"
              type="number"
              name="home_score"
              min={0}
              max={20}
              disabled={locked}
              value={homeScore}
              onChange={e => setHomeScore(e.target.value)}
              placeholder="—"
              className="text-center font-mono text-lg"
            />
          </div>
          <span className="pb-2.5 font-mono text-xl font-light text-subtle">:</span>
          <div className="flex-1 space-y-1">
            <label htmlFor="away_score" className="flex items-center gap-1.5 truncate text-xs text-subtle">
              <Flag name={awayTeam} size="sm" />
              <span className="truncate">{awayTeam}</span>
            </label>
            <Input
              id="away_score"
              type="number"
              name="away_score"
              min={0}
              max={20}
              disabled={locked}
              value={awayScore}
              onChange={e => setAwayScore(e.target.value)}
              placeholder="—"
              className="text-center font-mono text-lg"
            />
          </div>
        </div>
      </fieldset>

      {/* Player prop — optional, one slot */}
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium text-muted">
          Player prop <span className="font-normal text-subtle">(optional)</span>
        </legend>
        {squads ? (
          <>
            <PropSlot squads={squads} defaultValue={existing.propSlot ?? null} locked={locked} />
            <p className="text-xs text-subtle">
              A pick voids (no points lost) if the player never takes the pitch.
            </p>
          </>
        ) : (
          <p className="rounded-2xl border border-border bg-surface-2 px-4 py-3 text-xs text-subtle">
            Player props open once squads are confirmed.
          </p>
        )}
      </fieldset>

      {!locked && !coreComplete && (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <AlertCircle className="size-3.5" aria-hidden />
          Pick an outcome and an exact score to save.
        </p>
      )}

      <SubmitButton disabled={locked || !coreComplete} incomplete={!coreComplete} />
    </form>
  );
}
