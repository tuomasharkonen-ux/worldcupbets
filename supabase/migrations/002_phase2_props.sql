-- World Cup Bets — Phase 2: player props (goals & cards)
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed v1 schema (idempotent).

-- ─── prop scoring config ───────────────────────────────────────────────────────
-- Merge prop Glory values into league.config.glory without clobbering existing keys.
-- jsonb || jsonb is a shallow merge, so rebuild the nested `glory` object explicitly.

update league
set config = jsonb_set(
  config,
  '{glory}',
  (config -> 'glory') || jsonb_build_object(
    'first_goalscorer', 20,
    'anytime_scorer',   8,
    'carded',           6,
    'stat_leader',      15
  )
)
where id = 1;

-- ─── match_appearances ─────────────────────────────────────────────────────────
-- Who actually took the pitch (starting XI + subs who came on). Best-effort —
-- populated by the settle job from football-data.org lineups when available.
-- Powers prop void logic: a picked player who never appeared → bet voids.

create table if not exists match_appearances (
  id            uuid primary key default gen_random_uuid(),
  match_id      uuid not null references matches (id) on delete cascade,
  footballer_id uuid not null references footballers (id) on delete cascade,
  unique (match_id, footballer_id)
);

create index if not exists match_appearances_match on match_appearances (match_id);

-- ─── footballers: stable upsert key ─────────────────────────────────────────────
-- squads-sync upserts on fd_player_id so a re-run keeps each footballer's UUID
-- (bet selections store that UUID). Nulls stay distinct, so manually-added
-- footballers without an fd_player_id are unaffected.

create unique index if not exists footballers_fd_player_id_key on footballers (fd_player_id);
