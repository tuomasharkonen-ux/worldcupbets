-- World Cup Bets — PIN brute-force lockout
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent).
--
-- The shared league passcode is known to everyone in the league, so the only thing
-- stopping one player from logging in as another (or an outsider who learned the
-- passcode) is the per-player PIN — and PINs are deliberately low-entropy (4–6 digits).
-- These two columns add an account-scoped lockout: after MAX_PIN_ATTEMPTS consecutive
-- wrong PINs the name is frozen for a cooldown window. See src/app/join/actions.ts.

-- failed_pin_attempts — consecutive wrong-PIN count, reset to 0 on success.
-- pin_locked_until    — when set and in the future, login for this name is blocked.
alter table managers
  add column if not exists failed_pin_attempts integer not null default 0,
  add column if not exists pin_locked_until timestamptz;
