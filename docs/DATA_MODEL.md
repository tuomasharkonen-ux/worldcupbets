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
   ├──< manager_items (powerups / upgrades / sabotage, owned + active)
   ├──< comments (slate-scoped banter feed)
   └──< reactions (emoji on a comment)
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

`config.max_managers` (default 20, migration `006`) caps how many players can join — the cap is enforced in the join server action, not the DB.

`config.glory` holds the Glory payouts: `outcome_correct` (10), `exact_score_bonus` (25), and the player props `first_goalscorer` (20), `anytime_scorer` (10), `carded` (10). Prop values were added in migration `002`. (A `glory.participation` placeholder existed in `001`; Phase 3 retires it — participation is a **Coin** reward, never Glory. The `goal_difference` bonus and the `stat_leader` prop were both later removed — exact score is now all-or-nothing, and Stat Leader was never implemented.)

> **Per-bet Coin rubric (migration `003`)** sets `config.coins.*` per-bet keys —
> `outcome` (5), `exact` (10), `prop` (4). (The `goal_difference` Coin reward and
> Glory bonus were later removed.)
>
> **Daily-loop config (migration `005`)** adds `config.daily.rollover_hour_local` (9)
> and the slate-scoped Coin rewards `coins.participation` (10) + `coins.clean_slate`
> (15), plus `coins.streak_bonus_per_day` (1, linear) read by the slice-4 Hot Hand
> upgrade. (The earlier `coins.interest_rate` param was removed with the Vault concept.)
> See `GAME_DESIGN.md` §2 / §4.
>
> **Staking config (migration `004`)** restructures `config.stake` from the bare
> `multipliers` array into `tiers` — `{ coins, mult }` pairs that carry each stake's
> Coin cost alongside its Glory multiplier (`{0,1.0}`, `{10,1.25}`, `{25,1.5}`,
> `{50,2.0}`) — plus `cap_coins` (per-bet ceiling, 50, raisable via Bigger Wallet).
> The combined stage × stake multiplier is **uncapped** (the former `max_total_multiplier`
> was removed). See `GAME_DESIGN.md` §5.
>
> **Favorites config (migration `009`)** adds `config.favorites`: `base_odds` (5.5 — the
> top favorite → multiplier 1.0), `min_mult`/`max_mult` (1.0 / 5.0 clamp), the advancement
> `ladder` (`r32` 10, `r16` 20, `qf` 35, `sf` 55, `third` 40, `final` 75, `champion` 90 —
> base Points per milestone, before the team's odds multiplier), and the favorite-player
> rates `player_goal` (15) / `player_card` (−5). See `GAME_DESIGN.md` §10.

### `managers`
The humans (up to `config.max_managers`).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `display_name` | text | unique; the login identity |
| `avatar_url` | text | optional; stores a chosen emoji (no upload infra) |
| `glory` | int | cached, default 0 |
| `coins` | int | cached, default 100 |
| `joined_at` | timestamptz | |
| `pin_hash` | text | per-player PIN, scrypt `salt:hash` (migration `006`); nullable for pre-PIN players, back-filled on next login |
| `failed_pin_attempts` | int | consecutive wrong-PIN count (migration `007`), default 0; reset on successful login |
| `pin_locked_until` | timestamptz | brute-force lockout (migration `007`); when set and in the future, login for this name is frozen |
| `state` | jsonb | per-manager scratch state (migration `005`): streak counter, last-closed-slate guard |
| `favorite_team_id` | uuid FK → teams | first-login pick (migration `009`); the title bet, locked for the tournament |
| `favorite_footballer_id` | uuid FK → footballers | first-login pick (migration `009`); the favorite player, locked for the tournament |
| `onboarding_completed_at` | timestamptz | migration `009`; null until picks are made — both **gates** the onboarding flow and **locks** the picks (the server action refuses to overwrite a set timestamp) |

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
| `champion_odds` | numeric | pre-tournament decimal championship odds (migration `009`), seeded once; drives the favorite-team underdog multiplier |

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
| `winner_team_id` | uuid FK → teams | migration `009`; the true winner from football-data `score.winner` (a knockout decided on penalties leaves the scoreline level). Null for groups/draws. Powers the favorite-team champion/3rd-place milestones |

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

> **Void semantics:** a goalscorer/card prop on a player with no qualifying event settles as `void` (stake untouched — see staking note below — and no Glory) **only if** we have lineup data and the player isn't in it. When the feed omits lineups, `match_appearances` stays empty for that match and the prop settles as `lost` instead — we can't prove non-appearance. Players who *did* score/get carded clearly appeared, so they win regardless.

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
| `bet_type` | text | `outcome` \| `exact_score` \| `first_scorer` \| `anytime_scorer` \| `carded` (migration `008` dropped the never-implemented `stat_leader`) |
| `selection` | jsonb | shape depends on type (see below) |
| `stake_coins` | int | the **match** stake in Coins, recorded once on the `outcome` bet (0 on the other picks). Validated against `config.stake.tiers` + `cap_coins` at submission |
| `stake_mult` | numeric | the staked tier's Glory multiplier: 1.0 / 1.25 / 1.5 / 2.0. Written to **every** pick on the match so settlement amplifies each winning pick |
| `status` | text | `pending` \| `won` \| `lost` \| `void` |
| `glory_awarded` | int | filled at settlement |
| `created_at` | timestamptz | |
| `locked_at` | timestamptz | = match kickoff |

`selection` jsonb examples:
- outcome: `{ "result": "home" }`
- exact_score: `{ "home": 2, "away": 1 }`
- first_scorer / anytime / carded: `{ "footballer_id": "..." }`

> **One stake per match, spent either way, settle-time (not held upfront).** A single
> stake rides the whole match slip, not individual bets — `stake_coins` records it on
> the `outcome` bet and `stake_mult` is copied onto every pick. The stake is *not*
> deducted when bets are placed. At settlement the engine: amplifies **every won**
> pick's Glory by the combined stage × stake multiplier (uncapped); and spends the
> staked Coins **either way** — one negative
> `stake_spend` ledger entry per manager+match (`ref_type = 'match'`), win or lose.
> Staking is a deliberate investment: you pay the Coins regardless, and the flat Coin
> income on correct picks (GAME_DESIGN §4) wins some of it back. The goal-difference
> consolation on a near-miss exact-score bet is an independent rubric bonus the stake
> never amplifies. Because nothing is held, the submission balance check is a
> point-in-time guard (this match's stake + Coins already staked on other open
> matches must fit the balance), not a reservation — a manager could still over-commit
> across slates and dip negative on a bad day. Acceptable at five-player scale.

### `comments` (migration `010`)
The match-day banter feed on `/today` (all-set + settling states), scoped to a slate.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slate_key` | text | `YYYY-MM-DD` slate the feed belongs to |
| `manager_id` | uuid FK → managers | the author |
| `slip_manager_id` | uuid FK → managers, nullable | **unused** — see note below |
| `slip_match_id` | uuid FK → matches, nullable | **unused** |
| `body` | text | ≤500 chars; may be empty when there's a GIF (CHECK: body or gif) |
| `gif_url` | text, nullable | Giphy media CDN only, validated server-side |
| `created_at` | timestamptz | |

### `reactions` (migration `010`)
Emoji reactions on comments. A partial unique index makes one row per
(manager, comment, emoji), so the server action toggles by delete-or-insert.
Palette is fixed in `src/lib/social.ts`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `manager_id` | uuid FK → managers | who reacted |
| `emoji` | text | validated against `REACTION_EMOJIS` |
| `comment_id` | uuid FK → comments | the comment (nullable in SQL, always set in practice) |
| `slip_manager_id` | uuid FK → managers, nullable | **unused** |
| `slip_match_id` | uuid FK → matches, nullable | |
| `created_at` | timestamptz | |

> **Unused slip columns.** Migration `010` also supported targeting a manager's
> **slip** — the (manager, match) pair — with comments and reactions; that UI was cut
> the same day for being too noisy in the bets overview, which is now read-only. The
> columns, CHECKs, and partial indexes remain (no data, no writes) in case slip
> targeting returns; nothing in the app sets them.

> Both tables have RLS **enabled with no policies** — unlike the rest of the schema.
> The app only ever reaches them through the service-role key (which bypasses RLS),
> so this simply locks the Data API's `anon`/`authenticated` roles out.

### `ledger`
Append-only. Source of truth for every Glory and Coin movement.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `manager_id` | uuid FK → managers | |
| `currency` | text | `glory` \| `coins` |
| `amount` | int | signed (negative for spends/losses) |
| `reason` | text | `bet_win` \| `bet_coin` \| `stake_spend` \| `participation` \| `clean_slate` \| `fav_player` \| `team_r32`/`team_r16`/`team_qf`/`team_sf`/`team_third`/`team_final`/`team_champion` \| `purchase` \| `sabotage_in` \| `sabotage_out` \| `jinx` … |
| `ref_type` | text | `bet` \| `match` \| `slate` \| `season` \| `item` … |
| `ref_id` | text | the thing that caused it — a uuid for `bet`/`match`/`item`, a slate date key (`YYYY-MM-DD`) for `slate`-scoped grants, or the season key (`WC2026`) for `season`-scoped favorite-team milestones. Widened from uuid to text in migration `005`. |

> **Favorites (migration `009`)** add two ledger streams, both Glory:
> `fav_player` (`ref_type=match`) — one aggregated row per finished match the manager's
> favorite player featured in (goals × `player_goal` minus a single booking penalty); and
> `team_<milestone>` (`ref_type=season`, `ref_id=WC2026`) — one row per advancement
> milestone the favorite team reaches/wins, amount = base ladder × the team's odds
> multiplier. The `(reason, ref_type, ref_id, manager_id)` unique index makes both
> idempotent, so the every-10-min settle cron re-runs harmlessly. See `GAME_DESIGN.md` §10.
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

### `managers.state` (Phase 3 — built, migration `005`)

Per-manager scratch state the ledger isn't the right home for, as a `jsonb` column on
`managers` (default `{}`), updated at day-close:

- `outcome_streak` — consecutive slates with every outcome correct (drives the Hot
  Hand payout in slice 4). Incremented on an all-correct slate, reset to 0 otherwise.
- `last_closed_slate` — slate key (`YYYY-MM-DD`) of the last day-close processed.
  Guards the streak counter against a settlement re-run double-counting.

The Accumulator "declared/used this slate" flag and Vault bookkeeping join this object
in later slices. Chosen over recomputing from settled bets each morning for simpler
reads. See `src/settlement/dayclose.ts` (pure) + the `settle` route's slate-close step.

---

## Indexes that matter

- `bets (match_id, status)` — settlement scans open bets per match.
- `bets (manager_id, match_id)` — rendering a manager's slip.
- `ledger (manager_id)` — balance recompute / history.
- `ledger (reason, ref_type, ref_id, manager_id)` UNIQUE — idempotency.
- `matches (status, settled_at)` — the settle job's "what's finished and unsettled" query.
- `matches (kickoff_at)` — lock checks + upcoming-fixtures view.
- `comments (slate_key, created_at)` — the day's feed, in order.
- `reactions (manager_id, comment_id, emoji)` partial UNIQUE — one reaction per comment per emoji; makes the toggle race-safe.
- `reactions (comment_id)` — fan-in when rendering chips.

---

## Draft layer (BUILD_PLAN Phase 6) — not built in v1

Designed so it slots in without touching the above. Adds:

- `draft_picks` — `manager_id`, `footballer_id` or `team_id`, `acquired_price`, `acquired_at`.
- A passive-scoring rule set that, during settlement, also awards Glory to managers who "own" performing footballers/teams.

Because settlement already iterates match events and player stats, the draft scorer is an additional consumer of the same data — no schema rework, just new tables and a new settlement step.
