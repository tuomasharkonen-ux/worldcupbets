'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { submitBet, type BetSlipState } from './actions';

function SubmitButton({ locked }: { locked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || locked}
      className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Saving…' : locked ? 'Locked' : 'Save bets'}
    </button>
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
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="rounded-lg border border-green-800 bg-green-950/50 px-3 py-2 text-sm text-green-300">
          Bets saved.
        </div>
      )}

      {/* Outcome */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-300">
          Match outcome{' '}
          <span className="text-zinc-500 font-normal">(optional)</span>
        </legend>
        <div className="grid grid-cols-3 gap-2">
          {(['home', 'draw', 'away'] as const).map(opt => {
            const label =
              opt === 'home' ? homeTeam : opt === 'away' ? awayTeam : 'Draw';
            return (
              <label
                key={opt}
                className={`relative flex cursor-pointer flex-col items-center rounded-lg border px-3 py-3 text-sm transition-colors
                  ${locked ? 'cursor-not-allowed opacity-50' : ''}
                  has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-950/30
                  border-zinc-700 bg-zinc-900 hover:border-zinc-600`}
              >
                <input
                  type="radio"
                  name="outcome"
                  value={opt}
                  disabled={locked}
                  defaultChecked={existing.outcome === opt}
                  className="sr-only"
                />
                <span className="font-medium text-white text-center leading-tight">{label}</span>
              </label>
            );
          })}
        </div>
        {/* Clear outcome option */}
        {!locked && (
          <label className="flex items-center gap-2 cursor-pointer text-xs text-zinc-500">
            <input
              type="radio"
              name="outcome"
              value=""
              defaultChecked={!existing.outcome}
              className="accent-zinc-500"
            />
            No outcome bet
          </label>
        )}
      </fieldset>

      {/* Exact score */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-zinc-300">
          Exact score{' '}
          <span className="text-zinc-500 font-normal">(optional, +15 GP bonus)</span>
        </legend>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="block text-xs text-zinc-400 mb-1 truncate">{homeTeam}</label>
            <input
              type="number"
              name="home_score"
              min={0}
              max={20}
              disabled={locked}
              defaultValue={existing.exactScore?.home ?? ''}
              placeholder="—"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-white text-lg font-mono placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
          <span className="text-zinc-500 text-xl font-light pt-5">:</span>
          <div className="flex-1">
            <label className="block text-xs text-zinc-400 mb-1 truncate">{awayTeam}</label>
            <input
              type="number"
              name="away_score"
              min={0}
              max={20}
              disabled={locked}
              defaultValue={existing.exactScore?.away ?? ''}
              placeholder="—"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-center text-white text-lg font-mono placeholder-zinc-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
            />
          </div>
        </div>
        <p className="text-xs text-zinc-500">Leave both empty to skip the exact score bet.</p>
      </fieldset>

      <SubmitButton locked={locked} />
    </form>
  );
}
