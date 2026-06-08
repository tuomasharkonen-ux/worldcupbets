-- World Cup Bets — retire the stat_leader prop
-- Apply via Supabase SQL editor or: supabase db push
--
-- Stat Leader was never implemented (it depended on the Sofascore per-player stats
-- feed that isn't wired) and is being dropped from the game. No rows ever used it, so
-- narrowing the bets.bet_type CHECK is safe. The settlement engine already treats any
-- unknown bet_type as a no-op void.

alter table bets drop constraint if exists bets_bet_type_check;
alter table bets add constraint bets_bet_type_check
  check (bet_type = any (array['outcome', 'exact_score', 'first_scorer', 'anytime_scorer', 'carded']));
