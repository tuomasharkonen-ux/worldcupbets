# Game Design — World Cup Bets

This is the rules-of-play spec. Every number here is a starting value, deliberately exposed so it's easy to tune. Treat the constants as config (a single `game_config` row / file), not magic numbers scattered through the code.

> **Design principle:** the *backbone* of the game runs on bulletproof data (final score, goalscorers, cards). The *spicy* layer (granular player props, sabotage) sits on top and is allowed to occasionally fail gracefully without breaking standings. See `ARCHITECTURE.md`.

---

## 1. The two currencies

| Currency | Symbol | Spendable? | Role |
| --- | --- | --- | --- |
| **Glory** | GP | No | The win condition. Only accumulates. The leaderboard. |
| **Coins** | ¢ | Yes | The strategic economy. Earned from play, spent on power-ups, upgrades, and sabotage. |

Keeping them separate is the whole point: sabotage and bad luck affect *how much Glory you can earn*, never your existing Glory total directly (with one deliberate exception — the Jinx — see §6). Nobody gets knocked down the real ladder by someone else's purchase, which avoids the feel-bad spiral that kills these games by week two.

**Starting balance:** every manager begins with **100¢** and **0 GP**.

---

## 2. The match loop

A "round" is a single match. The loop per match:

1. **Open** — match appears once the fixture is known; betting is open.
2. **Lock** — betting closes at **kickoff**. No edits after lock.
3. **Settle** — when the match finishes, the settlement job awards Glory and Coins and applies any active power-ups/sabotage.

### Bet-locking nuance (player props)

Starting lineups are only confirmed ~20–40 min before kickoff. So:

- Props that need a specific player (First Goalscorer, Stat Leader) let you pick **anyone in the 26-man squad**, not just the starting XI. If your pick doesn't play at all, that prop is **void** (stake refunded, no Glory).
- This keeps betting open early without punishing players for unknown lineups.

---

## 3. Scoring rubric (Glory)

### Core bets — mandatory, one each per match

| Bet | Condition | Glory |
| --- | --- | --- |
| **Outcome** | Correct Home win / Draw / Away win | **+10 GP** |
| **Goal difference** | Right outcome *and* right margin, but not exact score | **+5 GP** (bonus) |
| **Exact score** | Exact final scoreline correct | **+25 GP** (bonus, on top of outcome) |

Worked example: you predict **2–1 home**. Final is **3–1 home** → outcome ✅ (+10), margin ❌, exact ❌ = **10 GP**. Final is **3–2 home** → outcome ✅ (+10) + margin ✅ (+5) = **15 GP**. Final is **2–1 home** → +10 +5 +25 = **40 GP**.

### Player props — optional, pick up to **2 per match** (raisable via upgrade)

| Prop | Condition | Glory |
| --- | --- | --- |
| **First Goalscorer** | Your player scores the match's first goal | **+20 GP** |
| **Anytime Goalscorer** | Your player scores at any point | **+8 GP** |
| **Carded** | Your player gets a yellow or red | **+6 GP** |
| **Stat Leader** | Your player leads the match in a chosen stat (passes / shots / touches) | **+15 GP** |

> "Touches" depends on the Sofascore feed; "passes" and "shots" are safer. Offer all three but flag touches as "may void if stat unavailable."

### Knockout multipliers (catch-up mechanic)

All Glory from a match is multiplied by its stage factor. This keeps a trailing player mathematically alive to the end.

| Stage | Multiplier |
| --- | --- |
| Group stage | ×1.0 |
| Round of 32 | ×1.2 |
| Round of 16 | ×1.4 |
| Quarter-final | ×1.6 |
| Semi-final | ×1.8 |
| 3rd place / Final | ×2.0 |

---

## 4. The Coin economy

Coins flow gently — enough to fund strategy, not so much that the richest player snowballs.

| Source | Coins |
| --- | --- |
| **Participation** — submit a slip for a match | **+10¢** |
| **Correct core bet** | **+1¢** each |
| **Exact score hit** | **+5¢** bonus |
| **Correct prop** | **+2¢** each |

A typical engaged matchday nets a player roughly 15–30¢. Power-ups cost 25–50¢, so a meaningful purchase is a 1–2 matchday decision — that's the intended pacing.

---

## 5. The hybrid layer — staking Coins for Glory

This is what makes scoring "hybrid" rather than pure-rubric. Before a bet locks, you may attach a **stake** of Coins to it. If the bet **hits**, its Glory is multiplied. If it **misses**, you forfeit the staked Coins (no Glory penalty — your existing Glory is untouched).

| Stake | Cost | Glory multiplier on that bet |
| --- | --- | --- |
| Small | 10¢ | ×1.25 |
| Medium | 25¢ | ×1.5 |
| Large | 50¢ | ×2.0 |

- One stake per bet. Stake cap starts at **50¢** (raisable via upgrade).
- Stake multipliers stack with knockout multipliers but the **total multiplier per bet is capped at ×3.0** to prevent runaway swings.
- Staking is opt-in: a player can ignore it entirely and still compete on the fixed rubric.

---

## 6. Power-ups, upgrades, sabotage

All bought with Coins. Three kinds:

### Power-ups (one-shot, self-buff)

| Name | Cost | Effect |
| --- | --- | --- |
| **Double Down** | 40¢ | ×2 Glory on one chosen bet this matchday (respects the ×3 cap). |
| **Insurance** | 25¢ | If your exact-score bet misses by one total goal, you still get the goal-difference bonus. |
| **Hedge** | 35¢ | Submit two outcomes for one match; if either hits you score the outcome (exact-score bonus disabled for that match). |
| **Crystal Ball** | 30¢ | Reveal one opponent's full slip for one match before lock. |
| **Banker** | 20¢ | Nominate one match as your banker: +50% Glory if the slip fully hits, −50% if it fully busts. |

### Upgrades (permanent progression)

| Name | Cost | Effect |
| --- | --- | --- |
| **Bigger Wallet** | 60¢ | Stake cap +25¢. |
| **Extra Prop Slot** | 80¢ | Bet on 3 props per match instead of 2. |
| **Coin Magnet** | 100¢ | +10% to all Coin income, permanently. |

### Sabotage (PvP, target a rival)

| Name | Cost | Effect |
| --- | --- | --- |
| **Jinx** | 40¢ | Halve a chosen opponent's Glory from their *next* match. (The one mechanic that touches earned Glory — and only Glory earned *after* the Jinx.) |
| **Mugging** | 35¢ | Steal 20% of an opponent's Coin income from the next matchday. |
| **Lockout** | 45¢ | Opponent can't use power-ups or sabotage on their next match. |
| **Fog of War** | 25¢ | Hide the live leaderboard from one opponent for a matchday. |
| **Curveball** | 50¢ | Force an opponent's chosen core bet to flip to a random valid alternative. Brutal — counterable by Ward. |

### Counter-play

| Name | Cost | Effect |
| --- | --- | --- |
| **Ward** | 30¢ | Blocks the next sabotage aimed at you, then is consumed. Creates a bluff/mind-game layer — do they have a Ward up or not? |

### Catch-up rule: Tax the Leader

Any sabotage aimed at the **current Glory leader** costs **30% less**. Everyone can afford to gang up on first place, which keeps the pack tight over six weeks.

---

## 7. Tournament arc

The World Cup's own structure provides the escalation; the design leans into it.

- **Group stage (72 matches, ×1.0 Glory).** High volume. The economy-building phase: experiment with bets, accumulate Coins, buy early upgrades, scout rivals with Crystal Ball. Mistakes are cheap.
- **Knockouts (R32 → Final, 32 matches, ×1.2 → ×2.0).** Fewer matches, rising stakes. The hoard-or-spend tension peaks — do you blow your Coins on sabotage now or save for a Double Down on the Final? Sabotage gets vicious.
- **Final weekend (×2.0).** Last chance to overtake. A trailing player who's hoarded Coins can make a real run with stacked stakes and Double Downs.

---

## 8. Resolution rules & edge cases

These need to be explicit in code so settlement is deterministic:

- **Void props** (player didn't play): stake refunded, 0 Glory, no Coin penalty.
- **Stat unavailable** (e.g. touches feed missing for a match): Stat Leader prop voids, stake refunded.
- **Abandoned / postponed match:** all bets void, stakes refunded; re-open if rescheduled.
- **Own goals:** count toward the score, but the scorer is **not** credited for Goalscorer props (matches common bookmaker convention).
- **Penalty shootouts (knockouts):** do not change the "result" for scoring — the match is scored on the 90+ET scoreline as a draw for Outcome/Exact purposes, unless you decide otherwise. *(Decision point — flag for the league.)*
- **Settlement is idempotent:** re-running settlement on an already-settled match must not double-pay. Enforced via `matches.settled_at` + the append-only ledger.

---

## 9. Win condition

Most **Glory** after the Final is settled wins. Suggested tiebreaker order: (1) most exact-score hits, (2) most correct props, (3) a sudden-death bet on the Final's total goals decided at tournament start.
