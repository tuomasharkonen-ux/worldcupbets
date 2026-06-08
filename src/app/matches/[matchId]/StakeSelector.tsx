'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';

export type StakeTier = { coins: number; mult: number };

interface Props {
  /** Form field name, e.g. "stake_match". */
  name: string;
  tiers: StakeTier[];
  capCoins: number;
  /** Manager's current Coin balance — tiers costing more are disabled. */
  balance: number;
  defaultCoins?: number;
  disabled?: boolean;
  /** Notified with the chosen tier whenever the selection changes (for live previews). */
  onChange?: (coins: number, mult: number) => void;
}

// A row of large square buttons for staking Coins on the match slip (GAME_DESIGN §5). Writes the
// chosen tier's Coin cost into a hidden input the server action reads; the server
// re-derives the multiplier and enforces the cap + balance authoritatively.
export function StakeSelector({ name, tiers, capCoins, balance, defaultCoins = 0, disabled, onChange }: Props) {
  const [coins, setCoins] = useState<number>(defaultCoins);

  return (
    <div>
      <input type="hidden" name={name} value={coins} />
      <div className="flex gap-2">
        {tiers.map(tier => {
          const isNone = tier.coins === 0;
          // A tier you can't afford right now (other bets' stakes may reduce this
          // further — the server has the final say on the slip total).
          const unaffordable = !isNone && (tier.coins > capCoins || tier.coins > balance);
          const selected = coins === tier.coins;
          const tierDisabled = disabled || (unaffordable && !selected);
          return (
            <button
              key={tier.coins}
              type="button"
              disabled={tierDisabled}
              aria-pressed={selected}
              onClick={() => {
                setCoins(tier.coins);
                onChange?.(tier.coins, tier.mult);
              }}
              className={`flex aspect-square flex-1 flex-col items-center justify-center gap-1 rounded-2xl border text-center transition-[transform,border-color,background-color,box-shadow]
                ${selected
                  ? '-translate-y-0.5 border-[var(--color-points)] bg-[color-mix(in_oklab,var(--color-points)_18%,transparent)] text-foreground shadow-[0_4px_0_0_var(--color-points-press)]'
                  : 'border-border bg-surface-2 text-muted hover:border-border-strong'}
                ${tierDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
            >
              {isNone ? (
                <span className="font-display text-sm font-semibold leading-tight">No stake</span>
              ) : (
                <>
                  <Coins className="size-4 text-points" aria-hidden />
                  <span className="font-display text-lg font-bold leading-none">{tier.coins}¢</span>
                  <span className="text-xs font-semibold leading-none text-points">×{tier.mult}</span>
                </>
              )}
            </button>
          );
        })}
      </div>

      {/* Display-only: the stake is charged at settlement, but preview the spend so
          the cost of a multiplier is clear at a glance. */}
      <p className="mt-2.5 flex items-center justify-between text-sm">
        <span className="text-subtle">Your balance</span>
        <span className="flex items-center gap-1 font-mono font-semibold text-foreground">
          <Coins className="size-3.5 text-points" aria-hidden />
          {balance - coins}¢
          {coins > 0 && <span className="font-sans text-xs font-normal text-subtle">(−{coins}¢)</span>}
        </span>
      </p>
    </div>
  );
}
