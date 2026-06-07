-- World Cup Bets — Phase 3 (slice 1): coins go live + goal-difference bonus
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- This slice wires the Coin economy's per-bet income and the goal-difference
-- bonus (Glory +5 / Coin +3) that was specced in GAME_DESIGN §3 but never built.
-- Slate-scoped income (daily participation, clean-slate, streak, interest) and
-- the daily-loop config land in later slices.

-- ─── Glory: add the goal-difference bonus; retire participation ─────────────────
-- Participation was always meant to be a Coin reward, not Glory (GAME_DESIGN §4).
-- Rebuild the nested `glory` object: add goal_difference, drop participation.

update league
set config = jsonb_set(
  config,
  '{glory}',
  ((config -> 'glory') - 'participation') || jsonb_build_object(
    'goal_difference', 5
  )
)
where id = 1;

-- ─── Coins: the per-bet income rubric (GAME_DESIGN §4) ──────────────────────────
-- Replace the v1 placeholders (participation / correct_bet) with the real rubric.
-- starting_balance is preserved. Slate-scoped coin rewards are added in a later slice.

update league
set config = jsonb_set(
  config,
  '{coins}',
  jsonb_build_object(
    'starting_balance', coalesce((config -> 'coins' ->> 'starting_balance')::int, 100),
    'outcome',          5,
    'goal_difference',  3,
    'exact',            10,
    'prop',             4
  )
)
where id = 1;
