-- World Cup Bets — Phase 3 (slice 3): the daily game (slates, day-close, recap)
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- Adds the daily-loop config, the slate-scoped Coin rewards, per-manager scratch
-- state for the streak/interest bookkeeping, and widens ledger.ref_id so slate-scoped
-- entries can be keyed by their slate date (a YYYY-MM-DD string, not a uuid).

-- ─── config.daily — the rollover boundary (GAME_DESIGN §2) ──────────────────────
update league
set config = jsonb_set(
  config,
  '{daily}',
  jsonb_build_object('rollover_hour_local', 9)
)
where id = 1;

-- ─── config.coins — slate-scoped rewards (GAME_DESIGN §4) ────────────────────────
-- Add the two day-close grants now (participation, clean_slate) plus the streak /
-- interest params the shop upgrades (Hot Hand / Vault) will read in slice 4. The
-- per-bet keys from migration 003 are preserved.
update league
set config = jsonb_set(
  config,
  '{coins}',
  (config -> 'coins')
    || jsonb_build_object(
      'participation', 10,
      'clean_slate', 15,
      -- escalating streak bonus by streak length (Hot Hand, slice 4)
      'streak_bonus', jsonb_build_object('2', 2, '3', 4, '4', 6),
      -- daily interest on unspent Coins (The Vault, slice 4)
      'interest_rate', 0.05
    )
)
where id = 1;

-- ─── managers.state — per-manager scratch state (DATA_MODEL) ─────────────────────
-- Streak counter, last-closed-slate guard, Accumulator/Vault bookkeeping. Updated at
-- day-close. Chosen over recomputing from settled bets each morning.
alter table managers
  add column if not exists state jsonb not null default '{}'::jsonb;

-- ─── ledger.ref_id → text ───────────────────────────────────────────────────────
-- Slate-scoped entries reference a slate by its date key, not a uuid. Existing uuid
-- refs cast losslessly to text; the idempotency unique index rebuilds automatically.
alter table ledger
  alter column ref_id type text using ref_id::text;
