'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, CheckCircle2, Loader2, Lock, Save, Sparkles, Zap } from 'lucide-react';
import { submitBet, type BetSlipState } from './actions';
import { PropSlot, type PropType, type SlipSquads } from './PropSlot';
import { StakeSelector, type StakeTier } from './StakeSelector';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Flag } from '@/components/ui/flag';

export type { SlipSquads, SlipPlayer } from './PropSlot';

function SubmitButton({
  disabled,
  incomplete,
  saved,
  hasNext,
  counter,
}: {
  disabled: boolean;
  incomplete: boolean;
  saved: boolean;
  hasNext: boolean;
  counter?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      variant={saved ? 'success' : 'primary'}
      disabled={pending || disabled || saved}
      // On the success flash keep it functionally disabled (no resubmit) but fully
      // active-looking — undo the default disabled dimming/flattening.
      className={`w-full ${saved ? 'disabled:opacity-100 disabled:shadow-[0_5px_0_0_var(--color-success-press)]' : ''}`}
    >
      {saved ? (
        <>
          <CheckCircle2 className="size-5 animate-hit-pop" aria-hidden />
          Bet saved
          {hasNext && <ArrowRight className="size-5" aria-hidden />}
        </>
      ) : pending ? (
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
          {counter && (
            <span className="ml-0.5 rounded-full bg-black/15 px-2 py-0.5 font-mono text-xs font-bold">
              {counter}
            </span>
          )}
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
  // Staking config (GAME_DESIGN §5) + the manager's current Coin balance.
  stake: { tiers: StakeTier[]; capCoins: number; balance: number };
  // Scoring config for the live max-winnings counter (GAME_DESIGN §3/§5). All Points
  // values are pre-multiplier; the counter applies the stage × stake multiplier.
  scoring: {
    stageMult: number;
    outcome: number;
    exactBonus: number;
    props: Record<PropType, number>;
  };
  existing: {
    outcome?: 'home' | 'draw' | 'away';
    exactScore?: { home: number; away: number };
    propSlot?: { type: PropType; playerId: string } | null;
    // Coins staked on the whole match slip, prefilled when editing.
    stake?: number;
  };
  // Today-slate stepper context (GAME_DESIGN §2): this match's 1-based position in
  // the slate, the total, and where to go after saving (the next match, or null →
  // the "you're all set" Today screen). Absent for matches outside today's slate.
  slate?: { index: number; total: number; nextHref: string | null };
  // Edit flow (e.g. tapping a match from the "all set" Today screen): after saving,
  // return here instead of stepping through the slate. No counter/next-arrow shown.
  returnTo?: string;
  // Optional override for the submit action. Defaults to the real `submitBet`
  // server action; the admin preview passes a no-op so the slip is testable
  // without a session or DB.
  action?: (state: BetSlipState, formData: FormData) => Promise<BetSlipState>;
  // Called after the "Bet saved" animation instead of navigating. The admin preview
  // passes a no-op so it can replay the animation without leaving /admin.
  onSaved?: () => void;
}

export function BetSlip({ matchId, homeTeam, awayTeam, locked, squads, stake, scoring, slate, returnTo, existing, action, onSaved }: Props) {
  const boundAction = action ?? submitBet.bind(null, matchId);
  const [state, formAction] = useActionState<BetSlipState, FormData>(boundAction, {});
  const router = useRouter();

  // After a save we briefly flash "Bet saved" in the button, then advance to the
  // next slip (or the all-set screen). Only when we have stepper context — a plain
  // match keeps the old in-place "saved" banner.
  const stepping = slate != null || returnTo != null || onSaved != null;
  const [saved, setSaved] = useState(false);
  const advanced = useRef(false);
  useEffect(() => {
    if (!state.success || !stepping || advanced.current) return;
    advanced.current = true;
    setSaved(true);
    const t = setTimeout(() => {
      if (onSaved) {
        onSaved();
        setSaved(false);
        advanced.current = false; // let the preview replay
      } else {
        router.push(slate?.nextHref ?? returnTo ?? '/today');
      }
    }, 950);
    return () => clearTimeout(t);
    // Depend on the whole `state` (a fresh object per submit) so a repeated save
    // re-triggers — useActionState keeps `success` true across submits otherwise.
  }, [state, stepping, slate?.nextHref, returnTo, onSaved, router]);

  // Core bets are mandatory — track them so we can gate the submit button.
  const [outcome, setOutcome] = useState<string>(existing.outcome ?? '');
  const [homeScore, setHomeScore] = useState<string>(existing.exactScore?.home?.toString() ?? '');
  const [awayScore, setAwayScore] = useState<string>(existing.exactScore?.away?.toString() ?? '');

  // Mirrored from the child widgets so the max-winnings counter can react live.
  const [propType, setPropType] = useState<PropType | null>(existing.propSlot?.type ?? null);
  const [stakeMult, setStakeMult] = useState<number>(
    stake.tiers.find(t => t.coins === (existing.stake ?? 0))?.mult ?? 1,
  );
  const handlePropChange = useCallback((v: { type: PropType; playerId: string } | null) => setPropType(v?.type ?? null), []);
  const handleStakeChange = useCallback((_coins: number, mult: number) => setStakeMult(mult), []);

  const coreComplete = outcome !== '' && homeScore !== '' && awayScore !== '';
  const hasExact = homeScore !== '' && awayScore !== '';

  // The exact score must agree with the chosen outcome (a win pick needs that team
  // ahead; a draw pick needs level scores).
  const impliedResult = hasExact
    ? Number(homeScore) > Number(awayScore)
      ? 'home'
      : Number(homeScore) < Number(awayScore)
        ? 'away'
        : 'draw'
    : null;
  const scoreMismatch = outcome !== '' && impliedResult !== null && impliedResult !== outcome;
  const mismatchMsg = scoreMismatch
    ? outcome === 'draw'
      ? 'You picked a draw — the exact score must be level.'
      : `You picked ${outcome === 'home' ? homeTeam : awayTeam} to win — the exact score must show them ahead.`
    : null;

  // Best-case Points if every current pick lands, with the stage × stake multiplier
  // applied (uncapped, rounded per pick to match the engine).
  const effMult = scoring.stageMult * stakeMult;
  const capPts = (base: number) => Math.round(base * effMult);
  const maxPoints =
    (outcome !== '' ? capPts(scoring.outcome) : 0) +
    (hasExact ? capPts(scoring.outcome + scoring.exactBonus) : 0) +
    (propType ? capPts(scoring.props[propType]) : 0);
  const hasPicks = outcome !== '' || hasExact || propType != null;

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
      {state.success && !stepping && (
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
        <legend className="flex w-full items-center justify-between text-sm font-medium text-muted">
          <span>Match outcome</span>
          <span className="font-mono text-xs font-semibold text-points">{scoring.outcome} pts</span>
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
                  checked={outcome === opt}
                  onChange={e => setOutcome(e.target.value)}
                  className="sr-only"
                />
                {opt !== 'draw' && <Flag name={label} size="lg" className="mb-1.5" />}
                {label}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Exact score — required */}
      <fieldset className="space-y-2.5">
        <legend className="flex w-full items-center justify-between text-sm font-medium text-muted">
          <span>Exact score</span>
          <span className="font-mono text-xs font-semibold text-points">{scoring.exactBonus} pts</span>
        </legend>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="home_score" className="flex items-center gap-1.5 truncate text-xs text-subtle">
              <Flag name={homeTeam} size="md" />
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
              <Flag name={awayTeam} size="md" />
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
        {mismatchMsg && (
          <p className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            {mismatchMsg}
          </p>
        )}
      </fieldset>

      {/* Player prop — optional, one slot */}
      <fieldset className="space-y-2.5">
        <legend className="flex w-full items-center justify-between text-sm font-medium text-muted">
          <span>
            Player prop <span className="font-normal text-subtle">(optional)</span>
          </span>
          {propType && (
            <span className="font-mono text-xs font-semibold text-points">
              {scoring.props[propType]} pts
            </span>
          )}
        </legend>
        {squads ? (
          <PropSlot
            squads={squads}
            defaultValue={existing.propSlot ?? null}
            locked={locked}
            onChange={handlePropChange}
          />
        ) : (
          <p className="rounded-2xl border border-border bg-surface-2 px-4 py-3 text-xs text-subtle">
            Player props open once squads are confirmed.
          </p>
        )}
      </fieldset>

      {/* Multiplier — one stake for the whole match slip (GAME_DESIGN §5) */}
      <fieldset className="space-y-2.5 rounded-2xl border border-border bg-surface-2/40 p-4">
        <p className="flex items-center gap-1.5 text-sm font-medium text-muted">
          <Zap className="size-4 text-points" aria-hidden />
          Add a multiplier
        </p>
        <p className="text-xs text-subtle">
          Extra confident in your picks? Spend some credit to add a multiplier to the results.
        </p>
        <StakeSelector
          name="stake_match"
          tiers={stake.tiers}
          capCoins={stake.capCoins}
          balance={stake.balance}
          defaultCoins={existing.stake}
          disabled={locked}
          onChange={handleStakeChange}
        />
      </fieldset>

      {/* Live max-winnings counter — plain info, not a card */}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-subtle">
            <Sparkles className="size-3.5 text-points" aria-hidden />
            Potential max
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {hasPicks ? 'if every pick lands' : 'make your picks to see your upside'}
            {stakeMult > 1 ? ` · ×${stakeMult} multiplier` : ''}
          </p>
        </div>
        <p className="shrink-0 font-mono text-2xl font-bold tabular-nums text-points">
          {maxPoints}
          <span className="ml-1 text-sm font-semibold text-points/80">pts</span>
        </p>
      </div>

      {!locked && !coreComplete && (
        <p className="flex items-center gap-1.5 text-xs text-subtle">
          <AlertCircle className="size-3.5" aria-hidden />
          Pick an outcome and an exact score to save.
        </p>
      )}

      <SubmitButton
        disabled={locked || !coreComplete || scoreMismatch}
        incomplete={!coreComplete || scoreMismatch}
        saved={saved}
        hasNext={slate?.nextHref != null}
        counter={slate && slate.total > 1 ? `${slate.index}/${slate.total}` : undefined}
      />
    </form>
  );
}
