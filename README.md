# World Cup Bets

A private betting league for the 2026 World Cup, for you and a circle of friends. Predict match outcomes, exact scores, and an optional bonus bet (first/anytime goalscorer, anytime assist, to score 2+, who gets carded, over/under total goals, or a clean sheet), lock at kickoff, and watch Points settle automatically after full time. No real money — just bragging rights between friends.

**Live:** <https://worldcupbets.vercel.app>

---

## Status

Phases 0–2 are **complete**. The core loop — join → bet → lock → settle → leaderboard — works end-to-end on real data, and player props (Phase 2) are built and unit-tested. Props go live once squads are synced (`/api/cron/squads-sync`) and migration `002` is applied. See [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) for the full phased roadmap and what's next.

## Stack

- **Next.js (App Router) + TypeScript + Tailwind v4** — server components for reads, server actions for writes.
- **Design system** — bold/playful: 3D buttons, glassmorphism, lucide icons, WCAG AA. Semantic tokens + `ui/` primitives (CVA + Radix Slot). See [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md).
- **motion (Framer Motion)** — spring choreography for the morning recap's FIFA-pack reveal (pick-by-pick reveal + per-slip rarity tiers). Shine/glow effects stay pure CSS.
- **Supabase Postgres** — game state. Accessed server-side with the service-role key; RLS intentionally off (trust model is "a private group of friends").
- **iron-session** — shared passcode + a per-player PIN → signed cookie that persists ~400 days (stays logged in on the device until you sign out). No email.
- **Vercel** — hosting + the daily crons (`fixtures-sync`, `squads-sync`, `af-map`).
- **cron-job.org** — the twice-daily `settle` cron (Vercel Hobby's cron limits made an external trigger necessary; see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
- **Jest** — unit tests for the settlement engine.

## How it works

1. **Join** — enter the shared `LEAGUE_PASSCODE`, a display name, and a 4–6 digit PIN → claim a manager slot → signed cookie keeps you logged in (~400 days). A new name signs you up and sets your PIN; a returning name requires that PIN, so nobody can log in as you just by knowing your name. League size is capped by `config.max_managers` (default 20). Edit your name, avatar, or PIN any time on the **/profile** page.
2. **Pick your favorites** — on first login, lock in a favorite **team** (a title bet scored on an odds-weighted advancement ladder — backing a longshot pays more at every stage it survives) and a favorite **player** (Points for every goal, a small penalty if booked). Both are fixed for the whole tournament; the picker shows the live Point rewards per pick. See `docs/GAME_DESIGN.md` §10.
3. **The Golden Bracket** — once the eight quarter-finalists are known, everyone gets **one free special bet on the run-in**: call the top four countries in exact order plus the tournament top scorer and their final goal tally. Underdog picks pay up to ×5 (multipliers from fresh post-R16 odds), a right-team-wrong-slot consolation keeps near-misses alive, and it locks at the first QF kickoff. Promoted on **/today**, placed in a dedicated `/golden-bracket` wizard, settled once at tournament end. See `docs/GAME_DESIGN.md` §11.
4. **Bet** — on any upcoming match, place an Outcome (home/draw/away) and Exact Score, plus an optional **bonus bet**. Bets lock at kickoff, checked server-side in UTC so the client clock can't cheat. The bonus-bet picker doubles as a form guide: each squad member shows matches played, goals, and cards at this World Cup plus a **SUSP** flag for players banned from this match — computed from our own settled data, so nobody has to research obscure squads before betting.
5. **Banter** — once your own slip is in, the all-set screen reveals a read-only **everyone's bets** digest for the day (scores, outcomes, stakes, bonus bets) and, below it, a slate-scoped **comments feed**: text, GIFs (Giphy search), and a fixed palette of emoji reactions on comments. Another manager's bets only become visible for a match once you've bet on it yourself (or it has kicked off), so nobody can copy picks. Both stick around through the settling state and reset with the next slate.
6. **Settle** — after full time, the `settle` job finds finished matches, runs the pure settlement engine, writes Points movements to the append-only `ledger`, and recomputes cached balances. Idempotent: re-running never double-credits.
7. **Leaderboard** — managers ranked by Points.
8. **Share** — once your slate is in, the all-set screen offers a **Share my bets** button that copies a compact, emoji-flag digest of your picks to the clipboard (Wordle-style, ready to paste into WhatsApp); the morning recap offers **Share my results** — a spoiler-free 🟩/⬛/⬜ grid with your points and leaderboard move (on the **finale** it splits the haul into match, Golden Bracket, and total); and once your Golden Bracket is in, its summary offers **Share my bracket** — the four placements in order plus your top-scorer call. All end in a link back to the game.

## Project layout

```
src/
  app/
    opengraph-image.tsx   OG/social share image (next/og, brand colors + country flags; fonts in assets/fonts/)
    join/                 passcode + PIN login/signup flow (page + server action)
    onboarding/           first-login favorite team + player picker (page + client picker + action)
    profile/              edit name, avatar, PIN, view locked favorites; sign out (page + server actions)
    fixtures/             full schedule grouped by NA match day (read-only; only today's slate is tappable); QF/SF/Final rows are emphasised, undrawn knockout slots show as "teams TBD" placeholders from the fixed WC2026 calendar, opens scrolled to the next match, and carries the Golden Bracket promo (or a pre-window teaser) into the knockouts
    matches/[matchId]/    bet slip (page + BetSlip client component + action)
    golden-bracket/       one-time Golden Bracket special bet wizard (page + flow + action)
    leaderboard/          Points + Coins ranking
    today/                daily slate: betting → all-set → settling → recap (+ ShareBetsButton;
                          Social = everyone's bets + banter feed, with actions.ts + social-data.ts).
                          The final's recap is a special "finale" variant: the leaderboard scene
                          reveals every manager's final-day + Golden Bracket Points and crowns the
                          league winner (see docs/GAME_DESIGN.md §11)
    admin/                hidden preview gallery — every view on mock data (no DB/session)
    api/cron/             fixtures-sync, squads-sync, af-map, settle, settle-backfill, af-probe  (CRON_SECRET-guarded)
    api/dev/              seed-match, finish-match  (test-only, CRON_SECRET-guarded)
    api/gifs/             Giphy search proxy for the banter feed  (session-guarded)
  components/
    Nav.tsx               top navigation (glass)
    ui/                   design-system primitives: button, card, badge, input
  settlement/             pure, unit-tested engine + day-close + favorites (team ladder + player) + golden bracket + types + fixtures
  lib/                    supabase client, session, cron auth, slate math, share-text builder, country→flag, cn() class helper
  types/                  hand-written DB types mirroring the schema
supabase/migrations/      001_initial_schema.sql … 016_golden_bracket.sql  (source of truth for the schema)
docs/                     ARCHITECTURE, DATA_MODEL, GAME_DESIGN, BUILD_PLAN, DESIGN_SYSTEM
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run dev                  # http://localhost:3000
npm test                     # settlement engine unit tests
npm run lint                 # eslint + tsc --noEmit
```

### Preview gallery (`/admin`)

A hidden, unlinked harness at [`/admin`](http://localhost:3000/admin) for eyeballing and testing every view on fabricated data — no session, no DB, instant. A side-nav switches between: the Today slate in all states (betting, all-set and settling — both including the social layer: everyone's bets, reactions, banter feed —, morning recap, finale recap, next-up on a rest day, no-fixtures-yet), the match bet slip (fully interactive — outcome/score/bonus bet/stakes; Save is a no-op) and a finished/settled match, the full + empty schedule, the leaderboard, the join screen (+ error), and a live **design-system** page (tokens, buttons, badges, cards, inputs, flags, stake chips, dialog, motion). Previews reuse the real components; mock data lives in `src/app/admin/mock.ts`.

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
| `GIPHY_API_KEY` | Giphy key for the banter feed's GIF picker (optional — the GIF button hides itself when unset) |

## Operations

- **Pull fixtures** (run once when football-data.org publishes WC2026, then daily via Vercel cron):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/fixtures-sync
  ```
- **Sync squads** (daily at 04:30 UTC via Vercel cron — pulls 26-man lists and marks players dropped from the official list as `out`; manual trigger for an immediate refresh):
  ```
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/squads-sync
  ```
- **Injury flags** — `footballers.availability` drives the OUT/DOUBT badges in the prop picker; maintained by hand on match-day mornings. See [`docs/INJURY_UPDATES.md`](docs/INJURY_UPDATES.md).

- **Force a settlement run** (otherwise automatic at 03:00 + 08:00 Helsinki):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/settle
  ```
- **Probe API-Football** (read-only sanity check: plan/quota, resolves the WC2026 league
  id, proves a finished fixture returns events + lineups — ~5 requests):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://worldcupbets.vercel.app/api/cron/af-probe
  ```
- **Map API-Football ids** (pairs our teams/matches/footballers to API-Football ids →
  `af_team_id` / `af_fixture_id` / `af_player_id`). This now runs **daily via Vercel cron**
  so knockout fixtures are mapped as their pairings are set; the manual trigger below is for
  an immediate refresh (e.g. after adding a team-name alias — **`?dry=1` first** and eyeball
  the unmatched lists before committing):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://worldcupbets.vercel.app/api/cron/af-map?dry=1"
  curl -H "Authorization: Bearer $CRON_SECRET" "https://worldcupbets.vercel.app/api/cron/af-map"
  ```
- **Repair already-settled bets** whose result changed after settlement — goalscorer/card
  props settled before granular data was available, **and** score-derived bets
  (outcome/exact_score/over_under/clean_sheet) settled against a score that was later
  corrected (e.g. a late or own goal added once the match was already finished+settled,
  which `syncStartedMatchStatuses` no longer re-syncs). Re-evaluates every bet on each
  settled match and reconciles its ledger rows; add `?dry=1` to preview without writing:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://worldcupbets.vercel.app/api/cron/settle-backfill?dry=1"
  ```
- **Database access** — `psql "$SUPABASE_CONNECTION_STRING"` for direct SQL.
- **Test the loop without real matches** — `GET /api/dev/seed-match` creates a synthetic match (kickoff +3 min), `POST /api/dev/finish-match` marks it finished with a score, then run `settle`. Both require the `CRON_SECRET` bearer header.

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system design, data ingestion, cron strategy, security.
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — full schema, tables, indexes, idempotency.
- [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md) — rules of play, scoring, the shop.
- [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md) — phased roadmap and current progress.
- [`docs/INJURY_UPDATES.md`](docs/INJURY_UPDATES.md) — injury/withdrawal flag runbook (football-data.org has no injury feed).
