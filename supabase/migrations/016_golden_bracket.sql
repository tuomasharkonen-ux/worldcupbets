-- 016_golden_bracket.sql — the Golden Bracket one-time special bet (QFs onward)
--
-- Every manager gets exactly ONE free bet: the top-4 countries with exact placements
-- (champion / runner-up / third / fourth, from the 8 quarter-finalists) plus the
-- tournament top scorer and his exact final goal tally. Opens once all 8 QF teams are
-- known, editable until the first QF kickoff (temporal lock, enforced in the server
-- action), settled at tournament end via src/settlement/golden-bracket.ts.

-- ─── teams: fresh post-R16 outright odds ────────────────────────────────────────
-- Decimal odds looked up 2026-07-06 (after 4 of 8 R16 ties). Separate from the
-- pre-tournament champion_odds so the favorites ladder is untouched. Seeded for all
-- 12 teams still alive at R16; only the 8 actual quarter-finalists get used. If an
-- unseeded team somehow reaches the QFs, the loader refuses to open the window until
-- its gb_odds is set (never silently pays min_mult on an underdog).
alter table teams
  add column if not exists gb_odds numeric;

update teams set gb_odds = case country_code
  when 'FRA' then 2.75  when 'ARG' then 5.4   when 'ENG' then 6.5   when 'ESP' then 7.5
  when 'POR' then 20    when 'COL' then 21    when 'MAR' then 30    when 'USA' then 31
  when 'NOR' then 34    when 'BEL' then 56    when 'SUI' then 76    when 'EGY' then 251
  else null end;

-- ─── golden_brackets: one row per manager, upserted until lock ──────────────────
create table if not exists golden_brackets (
  manager_id        uuid primary key references managers (id) on delete cascade,
  champion_team_id  uuid not null references teams (id),
  runner_up_team_id uuid not null references teams (id),
  third_team_id     uuid not null references teams (id),
  fourth_team_id    uuid not null references teams (id),
  top_scorer_id     uuid not null references footballers (id),
  scorer_goals      int  not null check (scorer_goals between 1 and 30),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- the four placement picks must be distinct teams (pairwise — CHECK can't subquery)
  check (champion_team_id <> runner_up_team_id),
  check (champion_team_id <> third_team_id),
  check (champion_team_id <> fourth_team_id),
  check (runner_up_team_id <> third_team_id),
  check (runner_up_team_id <> fourth_team_id),
  check (third_team_id <> fourth_team_id)
);

-- Deny-all RLS, same rationale as 015: the app only ever uses the service-role key.
alter table golden_brackets enable row level security;

-- ─── config.golden_bracket: scoring knobs ───────────────────────────────────────
-- slots: base Points for an exactly-right placement, each × the picked team's
--   underdog multiplier (√(gb_odds/base_odds) → nearest 0.5, clamped, same formula
--   as favorites). consolation: picked team finishes top-4 but in the wrong slot
--   (never stacks with an exact hit). scorer_player: flat Points when the picked
--   player is tied-or-sole top scorer by goals. scorer_exact / scorer_close: tally
--   bonus (exact / within ±1), paid only when the scorer line itself won.
update league set config = jsonb_set(
  config,
  '{golden_bracket}',
  '{
    "base_odds": 2.75,
    "min_mult": 1.0,
    "max_mult": 5.0,
    "slots": { "champion": 100, "runner_up": 60, "third": 40, "fourth": 30 },
    "consolation": 15,
    "scorer_player": 75,
    "scorer_exact": 50,
    "scorer_close": 20
  }'::jsonb
) where id = 1;
