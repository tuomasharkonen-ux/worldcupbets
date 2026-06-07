-- World Cup Bets — initial schema
-- Apply via Supabase SQL editor or: supabase db push

-- ─── league ──────────────────────────────────────────────────────────────────

create table if not exists league (
  id      int primary key default 1 check (id = 1),
  passcode text not null,
  season  text not null default 'WC2026',
  phase   text not null default 'group' check (phase in ('group','knockout','finished')),
  config  jsonb not null default '{}'::jsonb
);

insert into league (id, passcode, config)
values (1, 'changeme', '{
  "glory": {
    "outcome_correct": 10,
    "exact_score_bonus": 15,
    "participation": 2
  },
  "coins": {
    "starting_balance": 100,
    "participation": 5,
    "correct_bet": 10
  },
  "stake": {
    "multipliers": [1.0, 1.25, 1.5, 2.0],
    "max_total_multiplier": 3.0
  },
  "glory_multipliers": {
    "group": 1.0,
    "r32": 1.25,
    "r16": 1.5,
    "qf": 1.75,
    "sf": 1.75,
    "third": 1.5,
    "final": 2.0
  }
}'::jsonb)
on conflict (id) do nothing;

-- ─── managers ────────────────────────────────────────────────────────────────

create table if not exists managers (
  id           uuid primary key default gen_random_uuid(),
  display_name text unique not null,
  avatar_url   text,
  glory        int not null default 0,
  coins        int not null default 100,
  joined_at    timestamptz not null default now()
);

-- ─── teams ───────────────────────────────────────────────────────────────────

create table if not exists teams (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  country_code text not null,
  flag_url     text,
  fd_team_id   int unique,
  sofa_team_id int
);

-- ─── footballers ─────────────────────────────────────────────────────────────

create table if not exists footballers (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references teams (id) on delete cascade,
  name           text not null,
  position       text,
  squad_number   int,
  photo_url      text,
  fd_player_id   int,
  sofa_player_id int
);

-- ─── matches ─────────────────────────────────────────────────────────────────

create table if not exists matches (
  id                uuid primary key default gen_random_uuid(),
  fd_match_id       int unique not null,
  sofa_match_id     int,
  stage             text not null check (stage in ('group','r32','r16','qf','sf','third','final')),
  group_label       text,
  home_team_id      uuid not null references teams (id),
  away_team_id      uuid not null references teams (id),
  kickoff_at        timestamptz not null,
  status            text not null default 'scheduled' check (status in ('scheduled','live','finished','void')),
  home_score        int,
  away_score        int,
  glory_multiplier  numeric not null default 1.0,
  settled_at        timestamptz
);

create index if not exists matches_status_settled on matches (status, settled_at);
create index if not exists matches_kickoff on matches (kickoff_at);

-- ─── match_events ─────────────────────────────────────────────────────────────

create table if not exists match_events (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references matches (id) on delete cascade,
  footballer_id  uuid references footballers (id),
  type           text not null check (type in ('goal','own_goal','yellow','red','penalty')),
  minute         int,
  is_own_goal    bool not null default false
);

create index if not exists match_events_match on match_events (match_id);

-- ─── player_match_stats ──────────────────────────────────────────────────────

create table if not exists player_match_stats (
  id             uuid primary key default gen_random_uuid(),
  match_id       uuid not null references matches (id) on delete cascade,
  footballer_id  uuid not null references footballers (id) on delete cascade,
  touches        int,
  passes         int,
  shots          int,
  rating         numeric,
  unique (match_id, footballer_id)
);

-- ─── bets ────────────────────────────────────────────────────────────────────

create table if not exists bets (
  id             uuid primary key default gen_random_uuid(),
  manager_id     uuid not null references managers (id) on delete cascade,
  match_id       uuid not null references matches (id) on delete cascade,
  bet_type       text not null check (bet_type in ('outcome','exact_score','first_scorer','anytime_scorer','carded','stat_leader')),
  selection      jsonb not null,
  stake_coins    int not null default 0,
  stake_mult     numeric not null default 1.0,
  status         text not null default 'pending' check (status in ('pending','won','lost','void')),
  glory_awarded  int,
  created_at     timestamptz not null default now(),
  locked_at      timestamptz
);

create index if not exists bets_match_status on bets (match_id, status);
create index if not exists bets_manager_match on bets (manager_id, match_id);

-- ─── ledger ──────────────────────────────────────────────────────────────────

create table if not exists ledger (
  id         uuid primary key default gen_random_uuid(),
  manager_id uuid not null references managers (id) on delete cascade,
  currency   text not null check (currency in ('glory','coins')),
  amount     int not null,
  reason     text not null,
  ref_type   text not null,
  ref_id     uuid not null,
  created_at timestamptz not null default now(),
  -- idempotency guard: a re-run of settle on the same match produces zero new rows
  unique (reason, ref_type, ref_id, manager_id)
);

create index if not exists ledger_manager on ledger (manager_id);

-- ─── shop_items ──────────────────────────────────────────────────────────────

create table if not exists shop_items (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  kind        text not null check (kind in ('powerup','upgrade','sabotage','counter')),
  cost_coins  int not null,
  config      jsonb not null default '{}'::jsonb
);

-- ─── manager_items ───────────────────────────────────────────────────────────

create table if not exists manager_items (
  id                uuid primary key default gen_random_uuid(),
  manager_id        uuid not null references managers (id) on delete cascade,
  item_id           uuid not null references shop_items (id),
  target_manager_id uuid references managers (id),
  scope_match_id    uuid references matches (id),
  scope_matchday    date,
  status            text not null default 'owned' check (status in ('owned','active','consumed','blocked')),
  purchased_at      timestamptz not null default now(),
  consumed_at       timestamptz
);
