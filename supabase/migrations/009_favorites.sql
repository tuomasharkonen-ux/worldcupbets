-- World Cup Bets — favorite team + favorite player (onboarding picks + season scoring)
-- Apply via Supabase SQL editor or: supabase db push
--
-- On first login a manager locks in two picks for the whole tournament:
--   • a favorite TEAM — effectively a bet on who lifts the trophy, scored on an
--     odds-weighted advancement ladder (deeper run + longer odds = more Points).
--   • a favorite PLAYER — earns Points for every goal, loses a few if booked.
-- Both are immutable once onboarding_completed_at is set (enforced in the server action).

-- ─── managers: the locked picks + the onboarding gate ──────────────────────────
alter table managers
  add column if not exists favorite_team_id       uuid references teams (id),
  add column if not exists favorite_footballer_id uuid references footballers (id),
  add column if not exists onboarding_completed_at timestamptz;

-- ─── matches: the real knockout winner ─────────────────────────────────────────
-- A knockout decided on penalties leaves home_score = away_score, so the winner
-- can't be read off the scoreline. football-data's score.winner carries it; the
-- fixtures-sync writes it here for finished knockouts.
alter table matches
  add column if not exists winner_team_id uuid references teams (id);

-- ─── teams: pre-tournament championship odds ───────────────────────────────────
-- Decimal odds, seeded once below. The settlement engine derives an underdog
-- multiplier from this (√(odds/base_odds), clamped); it never changes mid-tournament
-- and the pick locks at the start anyway. Editable before kickoff.
alter table teams
  add column if not exists champion_odds numeric;

update teams set champion_odds = case country_code
  when 'ESP' then 5.5   when 'FRA' then 6     when 'ENG' then 7     when 'ARG' then 8
  when 'BRA' then 8.5   when 'GER' then 11    when 'POR' then 13    when 'NED' then 17
  when 'BEL' then 26    when 'USA' then 34    when 'URY' then 34    when 'NOR' then 41
  when 'COL' then 41    when 'CRO' then 51    when 'MAR' then 51    when 'JPN' then 67
  when 'MEX' then 67    when 'SEN' then 67    when 'SUI' then 81    when 'AUT' then 81
  when 'TUR' then 81    when 'ECU' then 101   when 'KOR' then 101   when 'CAN' then 151
  when 'EGY' then 151   when 'SWE' then 151   when 'CZE' then 201   when 'SCO' then 201
  when 'ALG' then 251   when 'CIV' then 251   when 'PAR' then 251   when 'BIH' then 301
  when 'GHA' then 301   when 'IRN' then 301   when 'RSA' then 301   when 'TUN' then 301
  when 'COD' then 501   when 'QAT' then 501   when 'KSA' then 501   when 'AUS' then 501
  when 'IRQ' then 751   when 'JOR' then 751   when 'PAN' then 751   when 'UZB' then 751
  when 'CPV' then 1001  when 'CUW' then 1001  when 'HAI' then 1001  when 'NZL' then 1001
  else 751 end;

-- ─── config.favorites: ladder + odds→multiplier params + fav-player rates ───────
-- ladder: Points awarded once each, when the team reaches that stage (champion/third
--   are awarded on winning the final / third-place playoff). Every rung is multiplied
--   by the team's odds multiplier, so a longshot pays more at every stage it survives.
-- base_odds: the top favorite's odds → multiplier 1.0. min/max clamp the multiplier.
-- player_goal / player_card: flat (un-multiplied) per-goal bonus and per-match
--   booking penalty for the favorite player.
update league set config = jsonb_set(
  config,
  '{favorites}',
  '{
    "base_odds": 5.5,
    "min_mult": 1.0,
    "max_mult": 5.0,
    "ladder": { "r32": 10, "r16": 20, "qf": 35, "sf": 55, "third": 40, "final": 75, "champion": 90 },
    "player_goal": 15,
    "player_card": -5
  }'::jsonb
) where id = 1;
