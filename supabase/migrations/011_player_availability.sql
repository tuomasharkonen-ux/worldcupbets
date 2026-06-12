-- World Cup Bets — player availability flags
-- Apply via Supabase SQL editor or: supabase db push
--
-- Manual availability flag surfaced in the player picker so managers don't bet
-- on players already confirmed out (injury, squad withdrawal). football-data.org
-- carries no injury feed, so this is maintained by hand (see docs/injury-updates.md)
-- and by squads-sync, which marks players who drop off the official 26-man list
-- as 'out'. Rows are never deleted — bet selections reference footballer UUIDs.
--
-- 'fit' is the silent default; only 'doubtful' and 'out' render badges.

alter table footballers
  add column if not exists availability text not null default 'fit'
    check (availability in ('fit', 'doubtful', 'out')),
  add column if not exists availability_note text,
  add column if not exists availability_updated_at timestamptz;
