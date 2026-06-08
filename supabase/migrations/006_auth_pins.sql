-- World Cup Bets — per-player PIN auth + configurable league size
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- Until now identity was display_name + a shared league passcode, so anyone who
-- knew the passcode could log in as any existing name. This adds a per-player PIN
-- (set on signup, required to reclaim a name on a new device) and lifts the
-- hardcoded five-player cap into config so the league can grow.

-- ─── managers.pin_hash — per-player secret ──────────────────────────────────────
-- Nullable: the original players have no PIN yet, so they keep working and set one
-- the next time they log in on a new device (the join flow back-fills it). New
-- signups always set a PIN. Stored as salt:hash (scrypt) — see src/lib/pin.ts.
alter table managers
  add column if not exists pin_hash text;

-- ─── config.max_managers — configurable league size (was hardcoded 5) ────────────
update league
set config = jsonb_set(
  config,
  '{max_managers}',
  '20'::jsonb,
  true
)
where id = 1;
