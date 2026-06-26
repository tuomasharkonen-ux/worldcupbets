-- 015_enable_rls_deny_all.sql
--
-- Lock the public anon / publishable API key out of every table.
--
-- The app talks to Postgres exclusively through the *service-role* key (see
-- src/lib/supabase.ts), which has BYPASSRLS — so enabling RLS does NOT touch any
-- query the game runs (same plans, same speed, no per-row policy evaluation).
--
-- What it DOES change: with RLS off, the project's anon/publishable keys (which are
-- public by design and protected only by RLS) could read AND write these tables
-- directly via PostgREST, bypassing every server-action authorization check. RLS on
-- with *no policy* = deny-all for the anon/authenticated roles, while service-role
-- keeps full access. We add no policies on purpose: the browser never queries
-- Supabase directly, so nothing legitimate needs anon/authenticated access.
--
-- comments + reactions already had RLS enabled (migration 010), so they're omitted.
-- Revert with: alter table public.<t> disable row level security;

alter table public.league             enable row level security;
alter table public.teams              enable row level security;
alter table public.footballers        enable row level security;
alter table public.matches            enable row level security;
alter table public.match_events       enable row level security;
alter table public.match_appearances  enable row level security;
alter table public.player_match_stats enable row level security;
alter table public.bets               enable row level security;
alter table public.managers           enable row level security;
alter table public.ledger             enable row level security;
alter table public.manager_items      enable row level security;
alter table public.shop_items         enable row level security;
