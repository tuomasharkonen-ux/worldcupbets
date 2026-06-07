# World Cup Bets

A private, five-player betting league for the 2026 World Cup. Predict match outcomes and exact scores, lock at kickoff, and watch Glory points settle automatically after full time. No real money — just bragging rights between friends.

**Live:** <https://worldcupbets.vercel.app>

---

## Status

Phases 0 and 1 are **complete and deployed**. The core loop — join → bet → lock → settle → leaderboard — works end-to-end on real data. See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the full phased roadmap and what's next.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind** — server components for reads, server actions for writes.
- **Supabase Postgres** — game state. Accessed server-side with the service-role key; RLS intentionally off (trust model is "five friends").
- **iron-session** — passcode join flow → signed cookie. No passwords, no email.
- **Vercel** — hosting + the `fixtures-sync` cron.
- **cron-job.org** — the twice-daily `settle` cron (Vercel Hobby's cron limits made an external trigger necessary; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
- **Jest** — unit tests for the settlement engine.

## How it works

1. **Join** — enter the shared `LEAGUE_PASSCODE` and a display name → claim a manager slot → signed cookie keeps you logged in.
2. **Bet** — on any upcoming match, place an Outcome (home/draw/away) and/or an Exact Score bet. Bets lock at kickoff, checked server-side in UTC so the client clock can't cheat.
3. **Settle** — after full time, the `settle` job finds finished matches, runs the pure settlement engine, writes Glory movements to the append-only `ledger`, and recomputes cached balances. Idempotent: re-running never double-credits.
4. **Leaderboard** — managers ranked by Glory.

## Project layout

```
src/
  app/
    join/                 passcode join flow (page + server action)
    fixtures/             upcoming matches + recent results
    matches/[matchId]/    bet slip (page + BetSlip client component + action)
    leaderboard/          Glory + Coins ranking
    api/cron/             fixtures-sync, settle  (CRON_SECRET-guarded)
    api/dev/              seed-match, finish-match  (test-only, CRON_SECRET-guarded)
  settlement/             pure, unit-tested engine + types + fixtures
  lib/                    supabase client, session, cron auth
  types/                  hand-written DB types mirroring the schema
supabase/migrations/      001_initial_schema.sql  (the source of truth for the schema)
docs/                     ARCHITECTURE, DATA_MODEL, GAME_DESIGN, BUILD_PLAN
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3000
npm test                     # settlement engine unit tests
npm run lint                 # eslint + tsc --noEmit
```

### Environment variables

All server-only; never shipped to the browser. Set in Vercel for production, `.env.local` for dev.

| Var | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access |
| `FOOTBALL_DATA_TOKEN` | football-data.org API token |
| `LEAGUE_PASSCODE` | Shared join code (also stored in the `league` row) |
| `SESSION_PASSWORD` | iron-session cookie encryption (≥32 chars) |
| `CRON_SECRET` | Bearer token guarding the cron + dev API routes |

## Operations

- **Pull fixtures** (run once when football-data.org publishes WC2026, then daily via Vercel cron):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/fixtures-sync
  ```
- **Force a settlement run** (otherwise automatic at 03:00 + 08:00 Helsinki):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/settle
  ```
- **Database access** — `psql "$SUPABASE_CONNECTION_STRING"` for direct SQL.
- **Test the loop without real matches** — `GET /api/dev/seed-match` creates a synthetic match (kickoff +3 min), `POST /api/dev/finish-match` marks it finished with a score, then run `settle`. Both require the `CRON_SECRET` bearer header.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data ingestion, cron strategy, security.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — full schema, tables, indexes, idempotency.
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — rules of play, scoring, the shop.
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — phased roadmap and current progress.
