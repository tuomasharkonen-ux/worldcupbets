-- World Cup Bets — Phase 3 (slice 2): staking
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- Adds the Coin cost of each stake tier and the per-bet stake cap to the config.
-- The bare `multipliers` array (GAME_DESIGN §5) never carried its Coin cost, so the
-- submission code had no config-driven way to price a stake. Replace it with a
-- `tiers` array of {coins, mult} pairs and a `cap_coins` ceiling (raisable later via
-- the Bigger Wallet upgrade). `max_total_multiplier` (the ×3 cap the engine enforces)
-- is preserved.

update league
set config = jsonb_set(
  config,
  '{stake}',
  jsonb_build_object(
    'tiers', jsonb_build_array(
      jsonb_build_object('coins', 0,  'mult', 1.0),
      jsonb_build_object('coins', 10, 'mult', 1.25),
      jsonb_build_object('coins', 25, 'mult', 1.5),
      jsonb_build_object('coins', 50, 'mult', 2.0)
    ),
    'cap_coins', 50,
    'max_total_multiplier',
      coalesce((config -> 'stake' ->> 'max_total_multiplier')::numeric, 3.0)
  )
)
where id = 1;
