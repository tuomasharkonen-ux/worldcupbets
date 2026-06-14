-- World Cup Bets — Bonus bets: rebrand + 4 new markets
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- Adds four optional bonus-bet markets alongside the existing player props:
--   over_under     — total match goals over/under a fixed 2.5 line (not player-based)
--   clean_sheet    — a chosen team concedes zero (not player-based)
--   anytime_assist — a chosen player records an assist
--   score_2plus    — a chosen player scores 2+ goals (a brace or better)
-- and stores assist events so anytime_assist can settle (api-football carries the
-- assister on each Goal event; previously discarded).

-- ─── bets.bet_type: allow the new markets ──────────────────────────────────────
alter table bets drop constraint if exists bets_bet_type_check;
alter table bets add constraint bets_bet_type_check check (
  bet_type in (
    'outcome', 'exact_score', 'first_scorer', 'anytime_scorer', 'carded',
    'stat_leader', 'over_under', 'clean_sheet', 'anytime_assist', 'score_2plus'
  )
);

-- ─── match_events.type: store assists ──────────────────────────────────────────
alter table match_events drop constraint if exists match_events_type_check;
alter table match_events add constraint match_events_type_check check (
  type in ('goal', 'own_goal', 'yellow', 'red', 'penalty', 'assist')
);

-- ─── scoring config ────────────────────────────────────────────────────────────
-- Add Glory values for the new markets and rebalance carded so payouts track how likely
-- each pick is: a chosen player getting booked (~22%) is rarer than that player scoring
-- at all (~30%), so carded moves above anytime_scorer (10 → 12). anytime_scorer is set
-- explicitly to its current value (10) for idempotence. Anchors (outcome 10,
-- exact_score_bonus 25, first_goalscorer 20) are unchanged. jsonb || jsonb is a shallow merge.
update league
set config = jsonb_set(
  config,
  '{glory}',
  (config -> 'glory') || jsonb_build_object(
    'anytime_scorer', 10,  -- unchanged (already 10 live)
    'carded',         12,  -- was 10 → 12 (rarer than anytime, now scores higher)
    'anytime_assist', 15,
    'score_2plus',    30,
    'clean_sheet',    8,
    'over_under',     6
  )
)
where id = 1;
