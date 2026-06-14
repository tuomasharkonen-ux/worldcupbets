-- 012_api_football_ids.sql
-- API-Football (api-sports.io) is the granular-stats provider for goals/cards/lineups,
-- which football-data.org's free tier does not carry (see docs/ARCHITECTURE.md). It uses
-- its own ids for fixtures, teams, and players, so we store a mapping alongside the
-- existing football-data (fd_*) and Sofascore (sofa_*) placeholder ids.
--
-- All nullable: backfilled by the one-off ID-mapping sync (match by kickoff+teams for
-- fixtures, by name within team for players). Nothing depends on them until populated.

alter table matches      add column if not exists af_fixture_id int;
alter table teams        add column if not exists af_team_id    int;
alter table footballers  add column if not exists af_player_id  int;

-- Fast lookups during settlement ingest (fixture → events/lineups) and mapping sync.
create index if not exists idx_matches_af_fixture_id     on matches     (af_fixture_id);
create index if not exists idx_footballers_af_player_id  on footballers (af_player_id);
create index if not exists idx_teams_af_team_id          on teams       (af_team_id);
