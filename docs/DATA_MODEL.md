# Data Model — World Cup Bets

Postgres (Supabase). Schema is written to be readable as a migration. Naming convention to avoid the classic trap: the **five humans are `managers`**, the **footballers on the pitch are `footballers`**. Never call a human a "player."

> Balances live in two places on purpose: an append-only `ledger` is the **source of truth**, and `managers.glory` / `managers.coins` are **caches** for fast reads, recomputed on each ledger write inside the same transaction.

---

## Entity overview

```
league (1 row of config)
managers ──< bets >── matches ──< match_events
   │                     ├──< match_appearances >─┐
   │                     └──< player_match_stats >── footballers >── teams
   │
   ├──< ledger
   └──< manager_items (powerups / upgrades / sabotage, owned + active)
```

---

## Tables

### `league`
Single-row global config. Keeps tunable values out of the code.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | int PK | always 1 |
| `passcode` | text | shared join code |
| `season` | text | "WC2026" |
| `phase` | text | `group` \| `knockout` \| `finished` |
| `config` | jsonb | all tunable constants (scoring values, costs, multipliers) |

`config.glory` holds the Glory payouts: `outcome_correct` (10), `exact_score_bonus` (15), `participation` (2), and the player props `first_goalscorer` (20), `anytime_scorer` (8), `carded` (6), `stat_leader` (15). Prop values were added in migration `002`.

### `managers`
The five humans.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `display_name` | text | unique |
| `avatar_url` | text | optional |
| `glory` | int | cached, default 0 |
| `coins` | int | cached, default 100 |
| `joined_at` | timestamptz | |

### `teams`
The 48 nations. Holds the cross-source ID mapping.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | internal |
| `name` | text | |
| `country_code` | text | ISO, drives flag URL |
| `flag_url` | text | flagcdn / Wikimedia |
| `fd_team_id` | int | football-data.org id |
| `sofa_team_id` | int | Sofascore id (nullable until mapped) |

### `footballers`
Squad members (~26 per team). Mapping plus display.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `team_id` | uuid FK → teams | |
| `name` | text | |
| `position` | text | |
| `squad_number` | int | |
| `photo_url` | text | from data API; flag+initials placeholder if null |
| `fd_player_id` | int | nullable |
| `sofa_player_id` | int | nullable |

### `matches`
The 104 fixtures.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `fd_match_id` | int | football-data.org id |
| `sofa_match_id` | int | nullable |
| `stage` | text | `group` \| `r32` \| `r16` \| `qf` \| `sf` \| `third` \| `final` |
| `group_label` | text | "A".."L", null for knockouts |
| `home_team_id` | uuid FK → teams | |
| `away_team_id` | uuid FK → teams | |
| `kickoff_at` | timestamptz | UTC; drives bet-lock |
| `status` | text | `scheduled` \| `live` \| `finished` \| `void` |
| `home_score` | int | nullable until finished |
| `away_score` | int | nullable |
| `glory_multiplier` | numeric | from stage (1.0 – 2.0) |
| `settled_at` | timestamptz | NULL until settled — the idempotency guard |

### `match_events`
Goals and cards, from football-data.org. Powers goalscorer/card props.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `footballer_id` | uuid FK → footballers | nullable (e.g. own goal) |
| `type` | text | `goal` \| `own_goal` \| `yellow` \| `red` \| `penalty` |
| `minute` | int | used to derive "first" goalscorer |
| `is_own_goal` | bool | scorer not credited for props |

### `match_appearances`
Who actually took the pitch (starting XI + subs who came on), from football-data.org lineups. **Best-effort** — populated by the settle job only when the lineup feed carries data. Powers prop **void** logic.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `footballer_id` | uuid FK → footballers | |
| | | UNIQUE `(match_id, footballer_id)` |

> **Void semantics:** a goalscorer/card prop on a player with no qualifying event settles as `void` (stake refunded, no Glory) **only if** we have lineup data and the player isn't in it. When the feed omits lineups, `match_appearances` stays empty for that match and the prop settles as `lost` instead — we can't prove non-appearance. Players who *did* score/get carded clearly appeared, so they win regardless.

### `player_match_stats`
Per-player granular stats, from Sofascore. Powers the Stat Leader prop. Sparse — rows only exist when the feed succeeded.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `footballer_id` | uuid FK → footballers | |
| `touches` | int | nullable |
| `passes` | int | nullable |
| `shots` | int | nullable |
| `rating` | numeric | nullable |

### `bets`
One row per bet (a slip is just the set of bets sharing a `manager_id` + `match_id`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `manager_id` | uuid FK → managers | |
| `match_id` | uuid FK → matches | |
| `bet_type` | text | `outcome` \| `exact_score` \| `first_scorer` \| `anytime_scorer` \| `carded` \| `stat_leader` |
| `selection` | jsonb | shape depends on type (see below) |
| `stake_coins` | int | 0 if no stake |
| `stake_mult` | numeric | 1.0 / 1.25 / 1.5 / 2.0 |
| `status` | text | `pending` \| `won` \| `lost` \| `void` |
| `glory_awarded` | int | filled at settlement |
| `created_at` | timestamptz | |
| `locked_at` | timestamptz | = match kickoff |

`selection` jsonb examples:
- outcome: `{ "result": "home" }`
- exact_score: `{ "home": 2, "away": 1 }`
- first_scorer / anytime / carded: `{ "footballer_id": "..." }`
- stat_leader: `{ "footballer_id": "...", "stat": "passes" }`

### `ledger`
Append-only. Source of truth for every Glory and Coin movement.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `manager_id` | uuid FK → managers | |
| `currency` | text | `glory` \| `coins` |
| `amount` | int | signed (negative for spends/losses) |
| `reason` | text | `bet_win` \| `participation` \| `stake_loss` \| `purchase` \| `sabotage_in` \| `sabotage_out` \| `jinx` … |
| `ref_type` | text | `bet` \| `match` \| `item` … |
| `ref_id` | uuid | the thing that caused it |
| `created_at` | timestamptz | |

> Idempotency: a `(reason, ref_type, ref_id, manager_id)` unique index prevents double-crediting if settlement re-runs.

### `shop_items`
Catalog of power-ups, upgrades, sabotage (static seed data — see `GAME_DESIGN.md` §6).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `code` | text | `double_down`, `jinx`, `ward`, `coin_magnet` … |
| `name` | text | |
| `kind` | text | `powerup` \| `upgrade` \| `sabotage` \| `counter` |
| `cost_coins` | int | |
| `config` | jsonb | effect params (multiplier, %, scope) |

### `manager_items`
Owned and/or active instances — purchases, active sabotages, consumed power-ups.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `manager_id` | uuid FK → managers | the owner / caster |
| `item_id` | uuid FK → shop_items | |
| `target_manager_id` | uuid FK → managers | nullable; set for sabotage |
| `scope_match_id` | uuid FK → matches | nullable; what it applies to |
| `scope_matchday` | date | nullable; for matchday-scoped effects |
| `status` | text | `owned` \| `active` \| `consumed` \| `blocked` (by Ward) |
| `purchased_at` | timestamptz | |
| `consumed_at` | timestamptz | |

Permanent upgrades (`kind = upgrade`) stay `active` forever and are read when computing a manager's stake cap, prop-slot count, and coin multiplier.

---

## Indexes that matter

- `bets (match_id, status)` — settlement scans open bets per match.
- `bets (manager_id, match_id)` — rendering a manager's slip.
- `ledger (manager_id)` — balance recompute / history.
- `ledger (reason, ref_type, ref_id, manager_id)` UNIQUE — idempotency.
- `matches (status, settled_at)` — the settle job's "what's finished and unsettled" query.
- `matches (kickoff_at)` — lock checks + upcoming-fixtures view.

---

## Draft layer (BUILD_PLAN Phase 6) — not built in v1

Designed so it slots in without touching the above. Adds:

- `draft_picks` — `manager_id`, `footballer_id` or `team_id`, `acquired_price`, `acquired_at`.
- A passive-scoring rule set that, during settlement, also awards Glory to managers who "own" performing footballers/teams.

Because settlement already iterates match events and player stats, the draft scorer is an additional consumer of the same data — no schema rework, just new tables and a new settlement step.
