'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';

export type StakeTier = { coins: number; mult: number };

interface Props {
  /** Form field name, e.g. "stake_outcome". */
  name: string;
  tiers: StakeTier[];
  capCoins: number;
  /** Manager's current Coin balance — tiers costing more are disabled. */
  balance: number;
  defaultCoins?: number;
  disabled?: boolean;
}

// A compact chip row for staking Coins on a single bet (GAME_DESIGN §5). Writes the
// chosen tier's Coin cost into a hidden input the server action reads; the server
// re-derives the multiplier and enforces the cap + balance authoritatively.
export function StakeSelector({ name, tiers, capCoins, balance, defaultCoins = 0, disabled }: Props) {
  const [coins, setCoins] = useState<number>(defaultCoins);

  return (
    <div>
      <input type="hidden" name={name} value={coins} />
      <div className="flex flex-wrap gap-1.5">
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
              onClick={() => setCoins(tier.coins)}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition-[transform,border-color,background-color,box-shadow]
                ${selected
                  ? 'border-[var(--color-points)] bg-[color-mix(in_oklab,var(--color-points)_18%,transparent)] text-foreground'
                  : 'border-border bg-surface-2 text-muted hover:border-border-strong'}
                ${tierDisabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}
            >
              {isNone ? (
                'No stake'
              ) : (
                <>
                  <Coins className="size-3" aria-hidden />
                  {tier.coins}¢
                  <span className="text-points">×{tier.mult}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
