# Architecture — World Cup Bets

## 1. The big picture

A small full-stack Next.js app on Vercel, a Supabase Postgres database, and two scheduled jobs that keep the game in sync with the real world. Five users, no real-time-frame-perfect requirement — which is what makes this simple.

```
                 ┌──────────────────────────────────────────────┐
                 │                   Vercel                       │
                 │                                                │
  Browser  ◄────►│  Next.js (App Router)                          │
  (5 users)      │   • UI: fixtures, bet slips, shop, leaderboard │
                 │   • API routes / server actions                │
                 │                                                │
                 │  Vercel Cron                                   │
                 │   • fixtures-sync   (daily)                    │
                 │   • settle          (every ~10 min)            │
                 └───────────┬───────────────────┬────────────────┘
                             │                   │
                   reads/writes            outbound fetches
                             │                   │
                 ┌───────────▼─────────┐ ┌───────▼──────────────────┐
                 │  Supabase Postgres  │ │  Data sources            │
                 │  (game state)       │ │  • football-data.org     │
                 └─────────────────────┘ │  • API-Football (Pro)    │
                                         └──────────────────────────┘
```

There is no websocket layer and no live in-match feed requirement. Bets lock at kickoff and settle after full time, so a polling cadence of minutes is entirely sufficient.

**Egress discipline (we run on the Supabase free tier — 5 GB/month).** The cost scales with match-day traffic, so the read-heavy paths are deliberately frugal:

- The `/today` social feed (`Social.tsx`) polls with `router.refresh()` on a **60-second** interval, only while the tab is visible **and** only while the slate isn't fully settled (the `poll` prop) — once every match has settled the feed is frozen and the recap takes over, so open tabs stop re-querying.
- `buildSocialData` (`social-data.ts`) projects only the columns the feed renders rather than `select('*')` — the per-poll payload is everyone's bets + the comment feed, so its width is multiplied by every open tab.
- `/fixtures` and `/leaderboard` wrap their **global** reads (the full match list; the standings) in `unstable_cache` with a 60s TTL, so a post-result rush collapses to roughly one DB read per minute. Per-viewer bits (your bets, the "you" highlight) stay uncached.

## 2. Components

### Frontend (Next.js App Router + TypeScript + Tailwind)

- **Server Components** fetch game state (fixtures, standings, balances) directly via the Supabase server client.
- **Client Components** handle interactivity: building a bet slip, attaching a stake, buying from the shop, picking a sabotage target.
- **Server Actions** (or API routes) handle all mutations: submit slip, purchase, activate sabotage. All writes go through the server — never let the client write balances directly.
- **Player form guide** — the prop picker annotates each squad member with tournament form (matches played, goals, cards, a suspension flag) computed in pure `lib/player-form.ts` from our own settled-match data (`match_events` + `match_appearances`) — no extra API calls. The match page fetches both teams' prior matches and passes the aggregates down; stats only appear once a team has a settled match.
- **Social sharing** — the all-set Today screen and the morning recap each offer a Wordle-style copy-to-clipboard share (`ShareBetsButton`). The slate digest (flags + scorelines + props) is built server-side; the recap digest (spoiler-free 🟩/⬛/⬜ grid + points + leaderboard move) is built client-side from the already-loaded `RecapData`. Both share a pure flag-emoji helper (`lib/country-flags.ts → toFlagEmoji`); the slate builder lives in pure `lib/share.ts` so the real page and the `/admin` preview render identical text.

### Database (Supabase Postgres)

- Accessed server-side with the **service-role key only** (never exposed to the browser).
- **Authorization is enforced in the server-action layer, not the DB** — the trust model is "five friends," and the app reaches Postgres only through the service-role key. **RLS is enabled on every public table with no policies (deny-all)** as defense-in-depth (migration `015`): the service-role key bypasses RLS so the game is unaffected (no per-row policy cost), while the project's public anon/publishable keys — which are protected *only* by RLS — are locked out of direct PostgREST access. We deliberately add no per-user policies: the browser never queries Supabase directly, so nothing legitimate needs anon/authenticated access.
- Cached balances (`managers.glory`, `managers.coins`) for fast reads, with an append-only `ledger` as the source of truth. See `DATA_MODEL.md`.

### Scheduled jobs

Each cron hits a protected API route (guarded by a `CRON_SECRET` bearer header so only an authorized caller can trigger it).

| Job | Cadence (as deployed) | Trigger | Responsibility |
| --- | --- | --- | --- |
| `fixtures-sync` | Daily, 08:00 Helsinki (05:00 UTC) | Vercel Cron (`vercel.json`) | Pull/refresh the fixture list, kickoff times, stages, and (later) squad rosters from football-data.org. Upsert into `matches`, `teams`, `footballers`. Also the **score-correction guard**: if the upsert changes the score/status of a match that was *already* settled, it re-grades just that match (`reSettleCorrectedMatch`) so a post-settlement fix reaches the bets — see "Score corrections after settlement" below. |
| `settle` | Hourly, 06:00–10:00 Helsinki | External — [cron-job.org](https://cron-job.org) | First **sync status/score** for every match that has kicked off but isn't finished yet (one windowed football-data call — so settlement never waits for the daily `fixtures-sync`), then find matches that are finished but `settled_at IS NULL`, run the settlement engine, write ledger entries, recompute cached balances, set `settled_at`. |
| `settle` (on-read nudge) | On `/today` load, when work is pending | `nudgeSettlement()` in the page | The morning window can close before a late-morning kickoff is *reported* finished — leaving it stuck `live` (and its slate's recap blocked) until the next day. Whenever a manager opens `/today` and any match has kicked off but isn't settled, the page schedules the **same** settlement pass in the background (`after()`, throttled in-memory), so results settle — and the recap appears for everyone — the same day instead of waiting for tomorrow's sweep. |

The settlement pass itself lives in `src/settlement/run.ts` (`runSettlement`), shared verbatim by the cron route and the nudge so they can never drift. It is fully idempotent, so the two triggers overlapping is harmless.

> **Why two cron providers?** The Vercel **Hobby** plan caps cron jobs at *daily cadence* and *two jobs total*. The WC2026 schedule (US venues) gives Finnish viewers two match clusters — evenings (~21:00–01:30) and early mornings (~03:00–07:30). Settling once a day would leave the morning cluster unsettled for nearly 24 h, so `settle` was moved to cron-job.org, which allows arbitrary schedules for free. The hourly morning sweep is safe to overlap with anything thanks to idempotency.

> **Why the on-read nudge too?** The morning window (06–10 Helsinki) is fixed, but a match kicking off ~07:00 finishes ~09:00 and football-data often still reports it `IN_PLAY` past the last cron tick — so it'd stay unsettled, blocking its slate's recap, until the *next* morning. The nudge closes that gap without a third cron provider: settlement runs on demand whenever someone opens the app.

> **Optimization, not required for v1:** make `settle` cheap when nothing's happening by early-returning if no match has finished since the last run. During match windows it does real work; overnight it's a no-op.

### Settlement engine (the heart)

A set of **pure functions** — no DB calls inside — that take inputs and return deltas:

```
settle(match, openBets, playerStats, activeModifiers) → {
  gloryDeltas:  { managerId → amount, reason }[],
  coinDeltas:   { managerId → amount, reason }[],
  betUpdates:   { betId → status, gloryAwarded }[],
}
```

Keeping it pure makes it unit-testable against fixture JSON without a database, which matters because this is where all the bugs will live. The caller wraps the result in a transaction and writes the ledger.

**Idempotency is mandatory.** The `settle` cron can run twice on the same finished match (overlapping invocations, retries). Guard with `matches.settled_at` and make ledger writes keyed so a re-run produces no new entries.

**Score corrections after settlement.** A match's score is only re-synced while it's `scheduled`/`live`; once it's `finished` + settled, `syncStartedMatchStatuses` leaves it alone. So if the final score is corrected *after* settlement — e.g. a late or own goal applied once the match was already settled, or a feed that briefly published a wrong score and then fixed it — score-derived bets (outcome/exact_score/over_under/clean_sheet) were graded against the old score and nothing in the normal settle path (which only picks up `settled_at IS NULL`) revisits them.

The daily `fixtures-sync` is the **only** writer that touches a finished match's score, so it owns the guard: before each upsert it captures the prior row, and when the score/status of an already-settled match actually changes it calls `reSettleCorrectedMatch(matchId)`. That re-runs the pure engine over just that match's bets and reconciles their ledger rows **in both directions** — delete the bet's prior win/coin rows, re-insert the new result — so a flip works `lost→won` *and* `won→lost`. (The plain settle path is insert-only and can't reverse a stale win, which is why "clear `settled_at` and re-settle" is not enough.) It fires only on a real change, so it adds no recurring reads — important on the free-tier egress budget.

The same per-match core (`reconcileMatchBets`) backs `backfillSettledBets` (`/api/cron/settle-backfill`), the manual sweep that re-evaluates *every* settled match at once — kept as an on-demand repair/audit tool, not a cron. (Two real incidents drove this: a Spain 4–0 exact-score pick marked lost when the 4th goal — an own goal — was applied post-settlement; and Egypt 1–1 Iran, where the feed briefly reported an away win with 3+ goals at settle time, paying an `over 2.5` and busting the draw/exact/under picks before the score was corrected to 1–1.)

## 3. Data ingestion — the two-source strategy

### football-data.org (the reliable backbone)

- Free tier includes the **World Cup** competition: fixtures, kickoff times, status, final score, standings.
- Auth via a free API token in `FOOTBALL_DATA_TOKEN`. Rate limit ~10 req/min — trivially within budget.
- Scores are *delayed* on the free tier, which is fine: settlement is post-match, not live.
- Powers: schedule, kickoff times, outcome, exact score → i.e. **the core score-based bets**.
- ⚠️ **Store the 90-minute (regulation) score, never `score.fullTime`.** For a knockout that goes the distance the feed's `fullTime` is an *aggregate* — it folds in extra-time goals **and** the penalty-shootout tally (a 1–1 settled on pens 3–4 comes back as `fullTime 4–5`). Bets settle on the regulation result (GAME_DESIGN), so both summary writers go through `regulationScore()` in `lib/football-data.ts`: `score.regularTime` when present, else `fullTime`. `winner_team_id` still uses `score.winner` for the favorite-team ladder. (June 30: NL 1–1 Morocco and another 1–1 shootout were stored as 4–5/4–4, flipping over/under + exact picks until backfilled via the fixtures-sync correction path.)
- ⚠️ **The summary feed can't always give the 90' score — recompute it from the goal timeline.** Our feed publishes only `fullTime` (with the ET goals folded in) and **no `regularTime`** for a match won in extra time, so `regulationScore()` returns `{…, certain: false}` in that case. Earlier shootouts *looked* fine only because they had no ET goals (1–1 through ET, so 90' == a.e.t.); the first knockout with a real extra-time goal exposed the gap (July 1: **Belgium 2–2 Senegal, 3–2 a.e.t.** was stored — and graded, and recapped — as 3–2, a Belgium win instead of the correct 90' draw). Fix: `settleMatch` ingests the goal feed for **every knockout** (deferring like the scorer props until it lands) and calls `regulationScoreFromEvents()` (`settlement/regulation.ts`, pure + unit-tested) to recompute the score from goals at **minute ≤ 90** (own goals credit the opponent), persisting the correction before the pure engine grades the slip. `reconcileMatchBets` applies the same correction so a one-off `settle-backfill` heals an already-settled match. And the daily **fixtures-sync must not clobber it**: when `regulationScore` is `certain: false` it keeps the stored (event-derived) score instead of re-writing the a.e.t. scoreline. This is idempotent — a match already at its 90' score recomputes to the same value.
- ⚠️ **`m.stage` is not trustworthy for the expanded 48-team knockout rounds.** football-data's stage literal for the new round-of-32 didn't match the `ROUND_OF_32` mapping in `mapStage()` (`fixtures-sync/route.ts`), so all 16 r32 fixtures silently fell through to the `?? 'group'` default — no `group` label, but tagged `stage: 'group'` — which meant the favorite-team "out of group" milestone (`settlement/favorites.ts`) never fired for anyone. The WC2026 stage *windows* are fixed and published well ahead of the tournament — only the teams in each slot are unknown beforehand — so `resolveStage()` now derives the stage from `kickoff_at` against a hardcoded boundary table for any fixture with no `group`, and only uses `mapStage()` as a logged cross-check. (June 30: discovered after a manager's favorite team won its r32 match and got 0 Points for it; backfilled the 16 mistagged rows' `stage`/`glory_multiplier` and the 6 missing `team_r32` ledger awards by hand.)
- ⚠️ **The free tier does NOT provide goalscorers, cards, or lineups for WC2026.** Verified 2026-06-14 against a `FINISHED` match: `/matches/{id}` returns `goals: []`, `bookings: []`, and empty `lineup` even days later — not a delay, a plan limitation. So first/anytime-scorer, carded, and lineup/appearance data **cannot** settle from this source — that's why **API-Football** (below) is now the granular provider. football-data stays the schedule/score backbone. When a match isn't yet mapped to API-Football the engine still **voids** scorer/card props (refund, no Glory) rather than falsely marking them lost. The scorer **grace-window defer** in `settleMatch` only applies to matches that actually have an API-Football mapping (`af_fixture_id` set): a football-data-only match's goal feed will *never* land, so deferring it can only ever expire — and because the 8h window outlasts the morning cron's last run (10:00 Helsinki / 07:00 UTC) for any post-~23:00-UTC kickoff, no cron tick ever exits the wait, leaving the match unsettled and its slate's recap silently blocked for everyone until some on-read nudge fires hours later. Unmapped matches therefore settle immediately, voiding their unwinnable scorer props. (June 13: Brazil 1–1 Morocco settled with zero scorers, voiding two correct Vinícius anytime picks — the trigger for this whole guard, now fixed by the API-Football integration. June 30: a free-tier 4–4 with one scorer prop hung unsettled past the cron window and blocked the whole night's recap — the trigger for gating the defer on `af_fixture_id`.)

### API-Football (the granular layer)

- Direct api-sports.io access (`https://v3.football.api-sports.io`, `x-apisports-key` header) — client in `src/lib/api-football.ts`. **Pro plan ($19/mo, ~$38 for the tournament):** the free plan only exposes seasons 2022–2024, not WC2026. Pro gives 7,500 req/day — vastly more than the few finished matches/day need.
- Powers: **first/anytime-scorer and carded props**, plus lineup/appearance data (form + the carded "no feed at all" guard) and the favorite-player goal/booking bonuses — everything that needs to know *who* scored or was booked.
- The WC2026 competition is **league `1`, season `2026`** (confirmed via the `af-probe` route; overridable with `API_FOOTBALL_WC_LEAGUE_ID` / `API_FOOTBALL_WC_SEASON`).
- **How it plugs in:** `fetchMatchEvents()` in `src/settlement/run.ts` dispatches on `matches.af_fixture_id` — a mapped match pulls goals/cards (`/fixtures/events`) and lineups (`/fixtures/lineups`) from API-Football; anything unmapped falls back to football-data. AF events carry `player.id`, so footballers resolve by `af_player_id` with **no name-matching on the settle path**. Appearances = starting XI + both players named in each substitution event (direction-agnostic).

### Sofascore unofficial API (unused)

- Was the original plan for the never-implemented **Stat Leader prop**. That prop was dropped (migration `008`), so Sofascore isn't called anywhere. `sofa_*` id columns remain as harmless placeholders.

### The ID-mapping gotcha (call this out to whoever builds it)

football-data.org and API-Football use **different IDs** for the same teams, fixtures, and players. The mapping layer:

- `teams.fd_team_id` ↔ `teams.af_team_id`
- `matches.fd_match_id` ↔ `matches.af_fixture_id`
- `footballers.fd_player_id` ↔ `footballers.af_player_id`

Built once (re-runnably) by the **`af-map` cron route** (`src/lib/af-mapping.ts`): teams match by name (with an alias table for Korea Republic↔South Korea, IR Iran↔Iran, …), fixtures by unordered team-pair + kickoff date, players by normalized name within each team (last-name fallback). Run `af-map?dry=1` first and eyeball the unmatched lists before committing. Migration `012` adds the three `af_*` columns. This is the single most annoying piece of plumbing; the dry-run report is how you tame it.

## 4. Security & access

- **Join:** shared `LEAGUE_PASSCODE` **+ a per-player PIN** (4–6 digits). A new display name signs up and sets its PIN; a returning name must present that PIN — so the passcode alone no longer lets anyone impersonate an existing player (the gap that made the original shared-passcode-only model unsafe to share widely). PINs are hashed with scrypt (`src/lib/pin.ts`); the column is nullable so pre-PIN players back-fill theirs on next login. A signed cookie keeps you "logged in" for ~400 days (`ttl` + cookie `maxAge` both set explicitly — iron-session's seal otherwise defaults to a 14-day expiry that would log players out mid-tournament). League size is capped by `config.max_managers` (default 20). No email.
- **PIN brute-force lockout:** PINs are low-entropy (4–6 digits), so once the shared passcode is known the PIN is all that protects a name. After `MAX_PIN_ATTEMPTS` (5) consecutive wrong PINs the name is frozen for 15 minutes (`managers.failed_pin_attempts` / `pin_locked_until`, migration `007`), enforced in the join server action.
- **No PII**, no payments, no real money. A private group of friends.
- **Direct DB access is not exposed:** all Postgres access is server-side via the service-role key, and there is no client-side Supabase client, so the database is reachable through the app only via server actions and route handlers. The project does still have enabled anon/publishable keys at the platform level (every Supabase project does), but **deny-all RLS** (above, migration `015`) keeps them from reading or writing any table directly.
- **Server-only secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `FOOTBALL_DATA_TOKEN`, `CRON_SECRET`, `SESSION_PASSWORD`, `GIPHY_API_KEY` live in Vercel env vars, never shipped to the client bundle. GIF search goes through the session-guarded `/api/gifs` proxy, and a comment's `gif_url` is validated server-side against the Giphy media CDN so arbitrary URLs can't be embedded.
- **Social write-path checks (migration `010`):** comments/reactions are inserted only via server actions that re-derive the author from the session and validate input (length, emoji palette, GIF host). The everyone's-bets digest is assembled server-side and only includes a match once the viewer's own core slip is in (or the match is locked), so a player who hasn't bet can't see picks through the social layer.
- **Cron protection:** cron routes check the `CRON_SECRET` header so they can't be triggered by randos hitting the URL.
- **Dev endpoints are production-blocked:** `/api/dev/*` (fabricate/seed match results) return 404 when `NODE_ENV === 'production'`, on top of the `CRON_SECRET` check, so they can never alter live data.

## 5. Timezones

Kickoffs are stored in UTC; rendered in the league's local time (Helsinki, EEST/EET). Bet-lock comparisons are done in UTC server-side to avoid client-clock cheating. The tournament spans US/Canada/Mexico kickoffs, so late-night Finnish times are expected — surface them clearly.

## 6. Notifications (optional, post-MVP)

Nice-to-have, not required. A simple per-matchday digest ("bets lock in 1 hour", "results are in") via a Telegram bot or webhook is the lowest-effort option and fits a 5-person group chat. Out of scope until the core loop works.
