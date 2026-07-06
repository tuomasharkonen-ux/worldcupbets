@AGENTS.md

# World Cup Bets — agent guide

A private, no-money betting league for the 2026 World Cup. Core loop: **join → bet → lock → settle → leaderboard**. Full product + architecture docs already exist — this file is only the operating rules and the map. Read the linked doc before working in that area; don't re-derive it here.

- **Product / features:** `README.md`
- **System design, cron strategy, security:** `docs/ARCHITECTURE.md`
- **Schema, tables, idempotency (source of truth = `supabase/migrations/`):** `docs/DATA_MODEL.md`
- **Rules of play, scoring, favorites ladder:** `docs/GAME_DESIGN.md`
- **Tokens, `ui/` primitives, visual language:** `docs/DESIGN_SYSTEM.md`
- **Roadmap / phase status:** `docs/BUILD_PLAN.md`

## Stack (one line)

Next.js 16 App Router (server components for reads, server actions for writes) · TypeScript · Tailwind v4 · Supabase Postgres (service-role, **RLS off** by design — trust model is "friends") · iron-session (passcode + PIN, no email) · Vercel hosting + crons · Jest for the settlement engine.

## Where things live

- `src/settlement/` — the **pure, unit-tested** settlement engine. `engine.ts` (bet grading), `regulation.ts` (90' score), `favorites.ts` (team ladder + player), `dayclose.ts`, `run.ts` (the orchestrated run). This is the money-critical core.
- `src/lib/` — supabase client, session, cron auth, slate math, player form, share text, bonus bets.
- `src/app/api/cron/` — `fixtures-sync`, `squads-sync`, `af-map`, `settle`, `settle-backfill`, `af-probe`. All `CRON_SECRET`-guarded. `src/app/api/dev/` — `seed-match` / `finish-match` for testing the loop.
- `src/app/admin/` — hidden preview gallery; every view on mock data (`src/app/admin/mock.ts`), no DB/session.
- `src/types/` — hand-written DB types mirroring the schema.

## Hard rules — settlement & ledger (money-critical, get these wrong and balances silently break)

- **Idempotent, always.** Re-running `settle` must never double-credit. The `ledger` is **append-only**; settlement writes movements to it and recomputes cached balances from it. Never mutate a ledger row in place to "fix" a balance.
- **Reconcile from the ledger, not the cache.** Cached coin/points balances are derived. `recomputeBalances` is non-atomic and can race with a concurrent cron/nudge run, leaving the cache short — the ledger is the source of truth; recompute from it, don't trust the cached number.
- **Bets settle on the 90' regulation score**, not the final score. `football-data`'s `fullTime` folds in extra time + penalties. Use `regulationScore` (`src/settlement/regulation.ts`): `regularTime ?? fullTime`, and for ET wins where the sim feed omits `regularTime`, recompute the 90' score from goal minutes. It returns `{home, away, certain}` — respect `certain`.
- **Knockouts:** settle outcome/score on the 90' score; the favorite-team reach-milestone pays on **winning** the tie (advancement), which is a separate signal from the 90' scoreline.
- **Keep the engine pure.** `src/settlement/*` takes data in and returns movements — no DB calls, no `fetch`, no clock reads inside the grading functions. That's what makes it unit-testable; new logic goes behind a test in `src/settlement/__tests__/`.
- **`settle-backfill`** is the tool for re-grading already-settled bets whose inputs changed (late/own goals, granular scorer/card data arriving after settlement). Always `?dry=1` first and eyeball the diff before writing.

## Other invariants (see the linked doc before changing)

- **Data / cost:** running on Supabase free-tier egress + Vercel Hobby — keep read paths frugal; don't add chatty queries. Secrets are all server-only and Vercel "sensitive" type (`env pull` returns empty; they only resolve in deployed code).
- **Next.js 16 ≠ your training data.** Per `AGENTS.md`, read `node_modules/next/dist/docs/` before writing App Router / server-action code.
- **UI wording:** user-facing UI always says **"Points"** — "Glory" is internal only. Cards wrap **interactive** elements; plain info goes outside cards. WCAG AA.

## Workflow checklist (before you call a change done)

1. `npm run lint` — this runs eslint **and** `tsc --noEmit`. Must be clean.
2. `npm test` — settlement engine unit tests. Any change to `src/settlement/*` needs matching test coverage.
3. If you changed behavior, docs, or ops: **update `README.md` + the relevant `docs/` file** in the same change (standing expectation — docs are kept current, not batched later).
4. If you touched a component, view, or the design system: **keep the `/admin` gallery in sync** so it still renders every state on mock data.
5. Schema changes go in a new `supabase/migrations/NNN_*.sql` (the migrations are the schema's source of truth) — never edit an applied migration.

## Commands

```bash
npm run dev     # http://localhost:3000
npm run lint    # eslint + tsc --noEmit  (run before finishing)
npm test        # settlement engine unit tests
```

Cron/ops triggers (all need the `CRON_SECRET` bearer header) and env-var reference live in **README.md → Operations / Environment variables**.
