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

## 2. The daily loop (and the match loop inside it)

The game is played as a **daily roguelike**. The World Cup's schedule does the
pacing; Finland's timezone makes it sing (NA kickoffs land late evening → small
hours Helsinki, settlement runs in the morning).

```
   morning              all day                 late evening → small hours
 ┌──────────┐      ┌──────────────────┐        ┌────────────────────────┐
 │ SETTLE   │  →   │  PLAN & SHOP      │   →    │  MATCHES PLAY & LOCK    │  → (next day)
 │ last     │      │  • read recap     │        │  • each bet locks at    │
 │ night's  │      │  • spend coins    │        │    its match's kickoff  │
 │ slate    │      │  • build tonight's│        │  • power-up loadout     │
 │ → coins  │      │    slip + stakes  │        │    locks at 1st kickoff │
 └──────────┘      └──────────────────┘        └────────────────────────┘
```

A **slate** is a betting day: the matches whose kickoff falls between two
consecutive day-boundaries. The boundary is a configurable Helsinki hour
(`config.daily.rollover_hour_local`, default **09:00**) — after the last night
game finishes (~06:00) and before the next slate's first kickoff. A game kicking
off at 04:00 Helsinki belongs to the **previous evening's slate**. Slate membership
is **computed** from `kickoff_at`, not stored. Rest days (no matches) simply skip a
beat: no slate, no recap; the shop stays open on the existing balance. On a rest day
the **Today** view doesn't dead-end — it looks ahead to the next slate that *has*
fixtures and opens betting on it right away (framed as "Next up"), so the next games
are always one tap from a slip. Only when no future fixtures are known at all does it
show an empty "No matches yet" state.

### The match loop inside a slate

1. **Open** — match appears once the fixture is known; betting is open.
2. **Lock** — each match's bets close at **its own kickoff** (server-checked, UTC).
   No edits after lock. **Power-ups and the Accumulator declaration lock at the
   slate's *first* kickoff** — once the night's first ball is kicked your tactical
   loadout is frozen, even though later matches' bets are still open.
3. **Settle** — once each morning the settlement job runs the closing slate: awards
   Glory and Coins, resolves stakes, applies active power-ups, then a **day-close**
   step grants slate-scoped bonuses (participation, clean-slate, streak)
   and stamps the slate so the **morning recap** can render.

### Bet-locking nuance (player props)

Starting lineups are only confirmed ~20–40 min before kickoff. So:

- Bonus bets that need a specific player (First/Anytime Goalscorer, Anytime Assist, To Score 2+, Carded) let you pick **anyone in the 26-man squad**, not just the starting XI. If your pick doesn't play at all, that bet is **void** (stake refunded, no Glory). The score-based bonus bets (Over/Under, Clean Sheet) have no such risk.
- This keeps betting open early without punishing players for unknown lineups.

### Player form guide (in the prop picker)

To spare managers from researching every squad before each slate, the player picker shows a slim per-player **form line** built from our own settled-match data (`lib/player-form.ts` — no extra API): matches played (`2M`), goals (⚽ — penalties count, own goals don't, mirroring prop rules), and cards (🟨/🟥). A **SUSP** badge flags players banned for this match (red card, or two accumulated yellows, in their team's most recent completed match; single yellows wipe after the QFs per FIFA rules). Stats appear only once a team has a settled match — each team's first match day shows nothing rather than a wall of zeroes. An ⓘ tooltip next to the picker search explains the legend.

---

## 3. Scoring rubric (Glory)

### Core bets — mandatory, one each per match

| Bet | Condition | Glory |
| --- | --- | --- |
| **Outcome** | Correct Home win / Draw / Away win | **+10 GP** |
| **Exact score** | Exact final scoreline correct | **+25 GP** (bonus, on top of outcome) |

Exact score is all-or-nothing — there is no goal-difference consolation. Worked example: you predict **2–1 home**. Final is **3–1 home** → outcome ✅ (+10), exact ❌ = **10 GP**. Final is **2–1 home** → outcome ✅ (+10) + exact ✅ (+25) = **35 GP**.

The two are still **scored as separate bets**, but the slip only asks for the **exact score** — the 1/X/2 result is **derived from it** (2–1 ⇒ home win), so there's no redundant double-entry and no separate result picker. The slip explains the split inline ("+10 for the correct result, +25 bonus for the exact scoreline"). Under the hood the score is written as both an `outcome` bet (+10 for a correct result) and an `exact_score` bet (+25 bonus, all-or-nothing) — a nailed score pays **35** across the two.

### Bonus bets — optional, one per match

A single optional **bonus bet** slot per slip, chosen from the same picker. Five are tied
to a specific player (any of the 26-man squad); two are settled straight off the final
score. Glory values scale inversely with how likely each is — the rarer the pick, the
bigger the reward (rebalanced in migration `013`).

| Bonus bet | Condition | Glory |
| --- | --- | --- |
| **Total Goals (Over/Under)** | Match total is over / under 2.5 goals | **+6 GP** |
| **Clean Sheet** | Your chosen team concedes no goals (a 0–0 wins both) | **+8 GP** |
| **Anytime Goalscorer** | Your player scores at any point | **+10 GP** |
| **Carded** | Your player gets a yellow or red | **+12 GP** |
| **Anytime Assist** | Your player assists a goal at any point | **+15 GP** |
| **First Goalscorer** | Your player scores the match's first goal | **+20 GP** |
| **To Score 2+** | Your player scores two or more goals | **+30 GP** |

Goalscorer/assist/2+ exclude own goals, and (like the scorer markets) **void** rather than
lose if the granular feed never lands. Over/Under and Clean Sheet read only the final
score, so they always settle cleanly.

### Knockout multipliers (catch-up mechanic)

All Glory from a match is multiplied by its stage factor — amplification kicks in only from the quarter-finals, so the long group stage stays flat and the knockouts swing harder. This keeps a trailing player mathematically alive to the end.

| Stage | Multiplier |
| --- | --- |
| Group stage | ×1.0 |
| Round of 32 | ×1.0 |
| Round of 16 | ×1.0 |
| Quarter-final | ×1.5 |
| Semi-final | ×1.75 |
| 3rd place | ×1.75 |
| Final | ×2.0 |

---

## 4. The Coin economy

Coins are the roguelike economy — scarce enough that spending genuinely hurts.
Income is tied to **daily engagement and skill**, awarded at morning settlement.

| Source | Coins | Scope |
| --- | --- | --- |
| **Daily participation** — submit a complete slip for *every* match on the slate | **+10¢** | per slate (day-close) |
| **Correct outcome** | **+5¢** each | per bet |
| **Exact score** | **+10¢** bonus | per bet |
| **Correct prop** | **+4¢** each | per bet |
| **Clean slate** — every outcome on the slate correct | **+15¢** | per slate (day-close) |

A solid 3-match night nets roughly **15–35¢** (e.g. `10 participation + 2×5 + 10 exact = 30¢`).
Upgrades cost 60–150¢, so each upgrade is a **3–6 good-day decision** — the intended
roguelike pacing. All values live in `config.coins.*`, tunable mid-tournament.

> **One rule makes the whole economy strategic:** Coins are the *only* resource for
> **both** the shop **and** staking. Every coin you stake is a coin you can't spend on
> an upgrade — that shared pool is the build-vs-burn decision the game turns on.

> Note: participation is a **Coin** reward (it was never a Glory reward). There is no
> participation Glory.

---

## 5. The hybrid layer — staking Coins for Glory

This is what makes scoring "hybrid" rather than pure-rubric. Before a match locks, you may attach a single **stake** of Coins to the whole slip. The stake is a **deliberate investment**: the Coins are spent *either way*, win or lose. In return, **every winning pick on that match** scores amplified Glory. You win some Coins back through the normal flat Coin income on correct picks (§4) — so a strong night is close to break-even on Coins while banking far more Glory.

| Stake | Cost | Glory multiplier on every pick |
| --- | --- | --- |
| Small | 10¢ | ×1.25 |
| Medium | 25¢ | ×1.5 |
| Large | 50¢ | ×2.0 |

- **One stake per match**, not per bet — its own section at the bottom of the slip, applying to the outcome, exact score, and any bonus bet together. Framed to players as **"Add a multiplier"** (not "stake"); the slip ends with a live **Potential max** counter showing best-case Points across the current picks, updating as picks and the multiplier change.
- Stake cap starts at **50¢** per match (raisable via upgrade).
- Stake multipliers stack with knockout multipliers, **uncapped** — a Final (×2.0) with a Large stake (×2.0) compounds to ×4.0.
- Staking is opt-in: a player can ignore it entirely and still compete on the fixed rubric.

**Implementation rulings:**
- The stake's multiplier amplifies the Glory of **each `won` pick** on the match, via
  the stage × stake multiplier.
- The staked Coins are spent **either way** — one negative `stake_spend` per
  manager+match at settlement, regardless of win/loss. There is no separate forfeit
  and no "keep on win"; the cost is the price of the multiplier.
- Stakes are recorded at submission but **charged at settlement** (no upfront Coin
  hold); the submission balance check is a point-in-time guard against over-committing
  across the slate's open matches. See `DATA_MODEL.md`.

---

## 6. Power-ups, upgrades, sabotage

All bought with Coins, in the daily shop. Three kinds. **Phase split:** the
**upgrades** and **self-buff power-ups** ship in **Phase 3** (the daily-game
overhaul); the **PvP sabotage + Ward** layer (and Crystal Ball, which reads
opponents' slips) lands in **Phase 5**.

### Upgrades — permanent progression (Phase 3)

The roguelike "build". Four paths; Coin Magnet and Bigger Wallet are **repeatable**
(tiered) so there's always something to spend on.

| Name | Cost | Effect | Path |
| --- | --- | --- | --- |
| **Coin Magnet** | 100¢ | +10% to all Coin income, permanently. Repeatable ×3 (10/20/30%). | 💰 Economy |
| **Bigger Wallet** | 60¢ | Stake cap +25¢. Repeatable (50→75→100→…). | 🎲 High-roller |
| **Hot Hand** | 70¢ | Correct-outcome **streak** across consecutive slates pays Coins **linearly: +1¢ per consecutive day** (day 2 → +2¢, day 3 → +3¢, …; resets on a wrong-outcome day). | 🔥 Streak |
| **Extra Prop Slot** | 80¢ | Bet on 2 props per match instead of 1. | 📊 Volume |
| **Accumulator** | 120¢ | Once per slate, declare an **all-outcomes parlay**: if *every* outcome on the slate hits, earn a big flat Glory bonus (≈ +30 GP × stage). All-or-nothing; locks at first kickoff. | 📊 Volume |

### Power-ups — one-shot, self-buff (Phase 3)

Attached to a match/slate, consumed at settlement. None touch another manager.

| Name | Cost | Effect |
| --- | --- | --- |
| **Double Down** | 40¢ | ×2 Glory on one chosen bet this slate. |
| **Hedge** | 35¢ | Submit two outcomes for one match; if either hits you score the outcome (exact-score bonus disabled for that match). |
| **Banker** | 20¢ | Nominate one match as your banker: +50% Glory if the slip fully hits, −50% if it fully busts. |

### Crystal Ball + sabotage (PvP, target a rival — Phase 5)

| Name | Cost | Effect |
| --- | --- | --- |
| **Crystal Ball** | 30¢ | Reveal one opponent's full slip for one match before lock. (Info, not sabotage — but reads rivals' bets, so it ships with the PvP layer.) |
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
- **Knockouts (R32 → Final, 32 matches, ×1.0 → ×2.0; amplified from the QF).** Fewer matches, rising stakes. The hoard-or-spend tension peaks — do you blow your Coins on sabotage now or save for a Double Down on the Final? Sabotage gets vicious.
- **Final weekend (×2.0).** Last chance to overtake. A trailing player who's hoarded Coins can make a real run with stacked stakes and Double Downs.

---

## 8. Resolution rules & edge cases

These need to be explicit in code so settlement is deterministic:

- **Void props** (player didn't play): stake refunded, 0 Glory, no Coin penalty.
- **Abandoned / postponed match:** all bets void, stakes refunded; re-open if rescheduled.
- **Own goals:** count toward the score, but the scorer is **not** credited for Goalscorer props (matches common bookmaker convention).
- **Penalty shootouts (knockouts):** do not change the "result" for scoring — the match is scored on the 90+ET scoreline as a draw for Outcome/Exact purposes, unless you decide otherwise. *(Decision point — flag for the league.)* Note the **favorite-team champion/3rd-place milestones** (§10) are the exception: they use the true tournament winner from `matches.winner_team_id` (which reflects the shootout), not the scoreline.
- **Settlement is idempotent:** re-running settlement on an already-settled match must not double-pay. Enforced via `matches.settled_at` + the append-only ledger.

---

## 9. Win condition

Most **Glory** after the Final is settled wins. Suggested tiebreaker order: (1) most exact-score hits, (2) most correct props, (3) a sudden-death bet on the Final's total goals decided at tournament start.

---

## 10. Favorites — your champion & favorite player (first-login picks)

On first login, before reaching the app, every manager locks in two season-long picks (migration `009`). Both are **immutable for the whole tournament** — the onboarding server action refuses to overwrite them once set. The picker shows the exact Point rewards for each pick and updates live as you browse teams.

### Favorite team — the title bet, scored on an odds-weighted ladder

Your team is effectively a bet on who lifts the trophy, but it pays out **progressively** as they advance rather than all-or-nothing at the Final — so there's no anticlimactic last-match leaderboard flip, and backing a team that goes deep is rewarded even if they don't win.

Each milestone pays **base Points × the team's underdog multiplier**:

| Milestone | Base | When |
| --- | --- | --- |
| Out of the group (reach R32) | 10 | fixture exists |
| Reach R16 | 20 | fixture exists |
| Reach QF | 35 | fixture exists |
| Reach SF | 55 | fixture exists |
| 3rd-place playoff win | 40 | finished, won |
| Reach Final (runner-up) | 75 | fixture exists |
| **Champion** | **90** | final finished, won |

A champion banks every rung on the title path (≈285 base before multiplier); a runner-up ≈195. Reach-rungs fire as soon as the knockout fixture appears (football-data only assigns a knockout slot once a team has qualified); champion/3rd resolve on a finished match via `matches.winner_team_id`.

**Underdog multiplier.** Derived from the team's pre-tournament decimal championship odds (`teams.champion_odds`): `mult = clamp(round½(√(odds / base_odds)), min, max)` with `base_odds` 5.5, clamp 1.0–5.0. The √ dampens the spread (a 100× longshot pays ~10×, capped at 5×) so a true minnow can't break the leaderboard, while the top favorites sit at ×1.0. Backing a dark horse pays more at **every** stage it survives — e.g. a ×3.5 side reaching the SF earns ~420 vs a favorite's ~120.

### Favorite player

One player from your chosen team's squad. Per match they feature in: **+15 Points per goal** (open-play or penalty; own goals never count), and **a single −5 Points if booked** (one penalty per match regardless of how many cards). Pure season-long trickle that keeps the favorites mechanic alive between the team's milestone moments.

### Settlement & surfacing

- Favorite-player Points settle inside the per-match settle job (the favorite's match now triggers event ingestion even with no prop bet on it). Favorite-team milestones settle in a dedicated step that runs every cron tick, independent of which matches just finished.
- Both are idempotent Glory ledger streams — `fav_player` (`ref_type=match`) and `team_<milestone>` (`ref_type=season`, `ref_id=WC2026`).
- Shown on **/profile** (locked picks + the team's full ladder + Points earned so far). The daily **/today recap** itemises any favorite Points earned that slate under the points odometer and folds them into the headline total and the standings before/after. Standings/leaderboard reflect the Points automatically since they recompute from the ledger.
