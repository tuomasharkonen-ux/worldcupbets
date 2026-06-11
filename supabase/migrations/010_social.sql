-- World Cup Bets — match-day social: comments feed + emoji reactions
-- Apply via Supabase SQL editor or: supabase db push
--
-- The /today all-set view grows a social layer: a per-slate comments feed (text
-- and/or GIF), comments that can point at another manager's slip for one match,
-- and emoji reactions on both comments and slips.
--
-- A "slip" target is (manager, match) — bets are deleted and re-inserted on every
-- edit (see submitBet), so bet ids are unstable and nothing here references bets(id).

create table if not exists comments (
  id              uuid primary key default gen_random_uuid(),
  slate_key       text not null,  -- YYYY-MM-DD slate the feed is scoped to
  manager_id      uuid not null references managers (id) on delete cascade,
  -- Optional slip target: set both or neither.
  slip_manager_id uuid references managers (id) on delete cascade,
  slip_match_id   uuid references matches (id) on delete cascade,
  body            text not null default '',
  gif_url         text,
  created_at      timestamptz not null default now(),
  check (body <> '' or gif_url is not null),
  check ((slip_manager_id is null) = (slip_match_id is null))
);

create index if not exists comments_slate on comments (slate_key, created_at);

create table if not exists reactions (
  id              uuid primary key default gen_random_uuid(),
  manager_id      uuid not null references managers (id) on delete cascade,
  emoji           text not null,
  -- Exactly one target: a comment, or a slip (manager × match).
  comment_id      uuid references comments (id) on delete cascade,
  slip_manager_id uuid references managers (id) on delete cascade,
  slip_match_id   uuid references matches (id) on delete cascade,
  created_at      timestamptz not null default now(),
  check (
    (comment_id is not null and slip_manager_id is null and slip_match_id is null)
    or (comment_id is null and slip_manager_id is not null and slip_match_id is not null)
  )
);

-- One row per (manager, target, emoji) — the server action toggles by delete-or-insert.
create unique index if not exists reactions_comment_unique
  on reactions (manager_id, comment_id, emoji) where comment_id is not null;
create unique index if not exists reactions_slip_unique
  on reactions (manager_id, slip_manager_id, slip_match_id, emoji) where comment_id is null;
create index if not exists reactions_comment on reactions (comment_id);
create index if not exists reactions_slip_match on reactions (slip_match_id);

-- The app reaches the DB exclusively through the service-role key, which bypasses
-- RLS — so enabling RLS with no policies costs nothing and keeps the Data API's
-- anon/authenticated roles locked out of the new tables.
alter table comments enable row level security;
alter table reactions enable row level security;
