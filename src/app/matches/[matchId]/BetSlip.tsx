'use client';

import { useState } from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertCircle, CheckCircle2, Loader2, Lock, Save } from 'lucide-react';
import { submitBet, type BetSlipState } from './actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MAX_PROPS = 2;

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || disabled} className="w-full">
      {pending ? (
        <>
          <Loader2 className="size-5 animate-spin" aria-hidden />
          Saving…
        </>
      ) : disabled ? (
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

export interface SlipPlayer {
  id: string;
  name: string;
  squad_number: number | null;
}

export interface SlipSquads {
  homeTeam: string;
  awayTeam: string;
  homePlayers: SlipPlayer[];
  awayPlayers: SlipPlayer[];
}

interface PropDef {
  field: 'first_scorer' | 'anytime_scorer' | 'carded';
  label: string;
  hint: string;
}

const PROPS: PropDef[] = [
  { field: 'first_scorer', label: 'First goalscorer', hint: '+20 pts' },
  { field: 'anytime_scorer', label: 'Anytime goalscorer', hint: '+8 pts' },
  { field: 'carded', label: 'Booked (yellow or red)', hint: '+6 pts' },
];

interface Props {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  locked: boolean;
  squads: SlipSquads | null;
  existing: {
    outcome?: 'home' | 'draw' | 'away';
    exactScore?: { home: number; away: number };
    props?: Partial<Record<'first_scorer' | 'anytime_scorer' | 'carded', string>>;
  };
}

function PlayerSelect({
  field,
  label,
  hint,
  squads,
  defaultValue,
  locked,
  onChange,
}: PropDef & {
  squads: SlipSquads;
  defaultValue: string;
  locked: boolean;
  onChange: (field: PropDef['field'], value: string) => void;
}) {
  const optionLabel = (p: SlipPlayer) =>
    p.squad_number != null ? `${p.squad_number}. ${p.name}` : p.name;

  return (
    <div className="space-y-1.5">
      <label htmlFor={field} className="flex items-center justify-between text-xs">
        <span className="text-subtle">{label}</span>
        <span className="text-points">{hint}</span>
      </label>
      <select
        id={field}
        name={field}
        defaultValue={defaultValue}
        disabled={locked}
        onChange={e => onChange(field, e.target.value)}
        className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm text-foreground transition-[border-color,box-shadow] focus-visible:border-[var(--color-primary-bright)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      >
        <option value="">— no pick —</option>
        <optgroup label={squads.homeTeam}>
          {squads.homePlayers.map(p => (
            <option key={p.id} value={p.id}>{optionLabel(p)}</option>
          ))}
        </optgroup>
        <optgroup label={squads.awayTeam}>
          {squads.awayPlayers.map(p => (
            <option key={p.id} value={p.id}>{optionLabel(p)}</option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}

export function BetSlip({ matchId, homeTeam, awayTeam, locked, squads, existing }: Props) {
  const boundAction = submitBet.bind(null, matchId);
  const [state, formAction] = useActionState<BetSlipState, FormData>(boundAction, {});

  // Track prop selections live so we can warn before the server rejects > MAX_PROPS.
  const [propValues, setPropValues] = useState<Record<string, string>>({
    first_scorer: existing.props?.first_scorer ?? '',
    anytime_scorer: existing.props?.anytime_scorer ?? '',
    carded: existing.props?.carded ?? '',
  });
  const onPropChange = (field: string, value: string) =>
    setPropValues(prev => ({ ...prev, [field]: value }));
  const chosenCount = Object.values(propValues).filter(Boolean).length;
  const tooMany = chosenCount > MAX_PROPS;

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

      {/* Player props */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-muted">
          Player props{' '}
          <span className="font-normal text-subtle">(optional, pick up to {MAX_PROPS})</span>
        </legend>
        {squads ? (
          <>
            {PROPS.map(p => (
              <PlayerSelect
                key={p.field}
                {...p}
                squads={squads}
                defaultValue={existing.props?.[p.field] ?? ''}
                locked={locked}
                onChange={onPropChange}
              />
            ))}
            {tooMany ? (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <AlertCircle className="size-3.5" aria-hidden />
                Pick at most {MAX_PROPS} props — clear one to continue.
              </p>
            ) : (
              <p className="text-xs text-subtle">
                {chosenCount}/{MAX_PROPS} selected. A pick voids (no points lost) if the player never takes the pitch.
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-subtle">
            Player props open once squads are confirmed.
          </p>
        )}
      </fieldset>

      <SubmitButton disabled={locked || tooMany} />
    </form>
  );
}
