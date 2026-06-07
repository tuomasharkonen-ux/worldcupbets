'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Lock, Save } from 'lucide-react';
import { submitBet, type BetSlipState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function SubmitButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || locked} className="w-full">
      {pending ? (
        <>
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : locked ? (
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
  existing: {
    outcome?: 'home' | 'draw' | 'away';
    exactScore?: { home: number; away: number };
  };
}

export function BetSlip({ matchId, homeTeam, awayTeam, locked, existing }: Props) {
  const boundAction = submitBet.bind(null, matchId);
  const [state, formAction] = useActionState<BetSlipState, FormData>(boundAction, {});

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

      {/* Outcome */}
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium text-muted">
          Match outcome <span className="font-normal text-subtle">(optional)</span>
        </legend>
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
                  defaultChecked={existing.outcome === opt}
                  className="sr-only"
                />
                {label}
              </label>
            );
          })}
        </div>
        {!locked && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-subtle">
            <input
              type="radio"
              name="outcome"
              value=""
              defaultChecked={!existing.outcome}
              className="size-3.5 accent-[var(--color-primary)]"
            />
            No outcome bet
          </label>
        )}
      </fieldset>

      {/* Exact score */}
      <fieldset className="space-y-2.5">
        <legend className="text-sm font-medium text-muted">
          Exact score{' '}
          <span className="font-normal text-points">(optional, +15 pts bonus)</span>
        </legend>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="home_score" className="block truncate text-xs text-subtle">
              {homeTeam}
            </label>
            <Input
              id="home_score"
              type="number"
              name="home_score"
              min={0}
              max={20}
              disabled={locked}
              defaultValue={existing.exactScore?.home ?? ''}
              placeholder="—"
              className="text-center font-mono text-lg"
            />
          </div>
          <span className="pb-2.5 font-mono text-xl font-light text-subtle">:</span>
          <div className="flex-1 space-y-1">
            <label htmlFor="away_score" className="block truncate text-xs text-subtle">
              {awayTeam}
            </label>
            <Input
              id="away_score"
              type="number"
              name="away_score"
              min={0}
              max={20}
              disabled={locked}
              defaultValue={existing.exactScore?.away ?? ''}
              placeholder="—"
              className="text-center font-mono text-lg"
            />
          </div>
        </div>
        <p className="text-xs text-subtle">Leave both empty to skip the exact score bet.</p>
      </fieldset>

      <SubmitButton locked={locked} />
    </form>
  );
}
