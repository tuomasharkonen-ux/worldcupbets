-- World Cup Bets — Atomic balance recompute
-- Apply via Supabase SQL editor or: supabase db push
-- Safe to run against the deployed schema (idempotent: create or replace).
--
-- Fixes a lost-update race in the app-side recompute. The TS recomputeBalances did a
-- read-modify-write per manager (read ledger → sum in JS → write managers.glory/coins).
-- Settlement fires from two independent triggers — the cron (/api/cron/settle) and an
-- on-read nudge on every /today load — so two runs could overlap: a recompute that read
-- the ledger *before* a slate's participation/clean-slate grant could write *after* the
-- grant's own recompute, clobbering it with a stale total. Symptom (2026-06-18): five
-- managers each one participation (10 coins) short of their ledger.
--
-- This function does the sum and the write in a single statement, against one committed
-- snapshot, with a row lock on managers — so there is no app-side window for a stale
-- value to overwrite a fresh one. The ledger remains the source of truth; the cached
-- managers.glory / managers.coins are derived here.
--
-- Every manager id passed in is reconciled even with zero ledger rows (coalesced to 0),
-- via unnest + left join.

create or replace function recompute_manager_balances(manager_ids uuid[])
returns void
language sql
volatile
as $$
  update managers m
  set glory = coalesce(agg.glory, 0),
      coins = coalesce(agg.coins, 0)
  from (
    select mid as id,
      sum(l.amount) filter (where l.currency = 'glory') as glory,
      sum(l.amount) filter (where l.currency = 'coins') as coins
    from unnest(manager_ids) as mid
    left join ledger l on l.manager_id = mid
    group by mid
  ) agg
  where m.id = agg.id;
$$;
