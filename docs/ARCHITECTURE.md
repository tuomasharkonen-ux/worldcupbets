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
                 └─────────────────────┘ │  • Sofascore (unofficial)│
                                         └──────────────────────────┘
```

There is no websocket layer and no live in-match feed requirement. Bets lock at kickoff and settle after full time, so a polling cadence of minutes is entirely sufficient.

## 2. Components

### Frontend (Next.js App Router + TypeScript + Tailwind)

- **Server Components** fetch game state (fixtures, standings, balances) directly via the Supabase server client.
- **Client Components** handle interactivity: building a bet slip, attaching a stake, buying from the shop, picking a sabotage target.
- **Server Actions** (or API routes) handle all mutations: submit slip, purchase, activate sabotage. All writes go through the server — never let the client write balances directly.

### Database (Supabase Postgres)

- Accessed server-side with the **service-role key only** (never exposed to the browser).
- **Row-Level Security is intentionally off.** The trust model is "five friends." Authorization is enforced in the server-action layer, not the DB. (Documented here so it's a choice, not an oversight.)
- Cached balances (`managers.glory`, `managers.coins`) for fast reads, with an append-only `ledger` as the source of truth. See `DATA_MODEL.md`.

### Scheduled jobs (Vercel Cron)

Defined in `vercel.json`. Each cron hits a protected API route (guarded by a `CRON_SECRET` header so only Vercel can trigger it).

| Job | Cadence | Responsibility |
| --- | --- | --- |
| `fixtures-sync` | Daily | Pull/refresh the fixture list, kickoff times, stages, and squad rosters from football-data.org. Upsert into `matches`, `teams`, `footballers`. |
| `settle` | Every ~10 min | Find matches that are finished but `settled_at IS NULL`, fetch result + events + player stats, run the settlement engine, write ledger entries, set `settled_at`. |

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

## 3. Data ingestion — the two-source strategy

### football-data.org (the reliable backbone)

- Free tier includes the **World Cup** competition: fixtures, results, match events (goals, cards, subs), standings, lineups.
- Auth via a free API token in `FOOTBALL_DATA_TOKEN`. Rate limit ~10 req/min — trivially within budget.
- Scores are *delayed* on the free tier, which is fine: settlement is post-match, not live.
- Powers: schedule, kickoff times, outcome, exact score, goalscorers, cards → i.e. **all core bets and the goal/card props**.

### Sofascore unofficial API (the granular layer)

- Undocumented JSON endpoints the Sofascore apps call (`api.sofascore.com/api/v1/...`). Used post-match for per-player stats: passes, shots, touches, ratings.
- Powers: the **Stat Leader prop** only.
- **Treat as best-effort.** It can change format or get Cloudflare-throttled. Therefore:
  - Call it **politely** — one request per finished match, a sane `User-Agent`, ≥several seconds between calls. Never hammer it.
  - Wrap every call in try/catch. On failure, **void affected Stat Leader props** (refund stake, no Glory) rather than failing the whole settlement.
  - Cache the raw response so you never re-fetch the same match.

### The ID-mapping gotcha (call this out to whoever builds it)

football-data.org and Sofascore use **different IDs** for the same teams and players. You need a mapping layer:

- `teams.fd_team_id` ↔ `teams.sofa_team_id`
- `footballers.fd_player_id` ↔ `footballers.sofa_player_id`

Build this once after the squads are confirmed (~June 1), semi-manually if needed — 48 teams is tractable. Match on name + country + DOB where possible. This is the single most annoying piece of plumbing; budget time for it.

### Fallback

If the Sofascore dependency proves too flaky during the tournament, the documented escape hatch is to subscribe to **API-Football** (~€19 for June+July) and point the granular-stats adapter at it instead. The ingestion layer is written behind an interface (`StatsProvider`) precisely so this swap is localized.

## 4. Security & access

- **Join:** shared `LEAGUE_PASSCODE`. Entering it lets you create/claim a manager. A signed cookie keeps you "logged in." No passwords, no email.
- **No PII**, no payments, no real money. Five trusted friends.
- **Server-only secrets:** `SUPABASE_SERVICE_ROLE_KEY`, `FOOTBALL_DATA_TOKEN`, `CRON_SECRET` live in Vercel env vars, never shipped to the client bundle.
- **Cron protection:** cron routes check the `CRON_SECRET` header so they can't be triggered by randos hitting the URL.

## 5. Timezones

Kickoffs are stored in UTC; rendered in the league's local time (Helsinki, EEST/EET). Bet-lock comparisons are done in UTC server-side to avoid client-clock cheating. The tournament spans US/Canada/Mexico kickoffs, so late-night Finnish times are expected — surface them clearly.

## 6. Notifications (optional, post-MVP)

Nice-to-have, not required. A simple per-matchday digest ("bets lock in 1 hour", "results are in") via a Telegram bot or webhook is the lowest-effort option and fits a 5-person group chat. Out of scope until the core loop works.
