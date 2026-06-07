# Build Plan — World Cup Bets

Build order is deliberately **vertical then horizontal**: get one thin slice working end-to-end (bet → lock → settle → leaderboard) before adding mechanics. Each phase should be shippable and playable on its own. The whole thing is sized for solo-with-AI-assistance over a few focused sessions before June 11.

> **Golden rule:** the core betting loop (Phase 1) must be rock-solid and tested before anything fancy. Everything else is additive. If you run out of time, a game that's *only* Phases 0–3 is still a great game.

---

## 📍 Current status (as of 2026-06-07)

**Phases 0 and 1 are complete and deployed to production** at <https://worldcupbets.vercel.app>. The full core loop (join → bet → lock → settle → leaderboard) has been verified end-to-end with a synthetic test match. The app is ready for the June 11 kickoff.

| Phase | Status |
| --- | --- |
| 0 — Foundations | ✅ Done |
| 1 — Core betting loop (MVP) | ✅ Done |
| 2 — Player props | ⬜ Not started |
| 3 — Coins + hybrid staking | 🟡 Partial (schema, config, and leaderboard coin display exist; `stake_mult` applied in engine; no staking UI or coin income yet) |
| 4 — Stat Leader prop | ⬜ Not started |
| 5 — Shop | ⬜ Not started |
| 6 — Draft / auction | ⬜ Not started |

**Remaining before kickoff:** trigger `fixtures-sync` once football-data.org publishes the WC2026 schedule; share the link + passcode with the five managers.

---

## Phase 0 — Foundations

Goal: an empty app that deploys and talks to the database.

- [x] Next.js + TypeScript + Tailwind scaffold, deployed to Vercel (hello-world).
- [x] Supabase project created; service-role key in Vercel env.
- [x] Apply schema from `DATA_MODEL.md` (`supabase/migrations/001_initial_schema.sql`).
- [x] `.env.example` + secrets wired (`FOOTBALL_DATA_TOKEN`, `CRON_SECRET`, `LEAGUE_PASSCODE`, `SUPABASE_*`, `SESSION_PASSWORD`).
- [x] Passcode join flow → claim a manager → signed cookie (iron-session). (This *is* the "auth.")

**Done when:** five people can join with the passcode and see their (empty) profile. ✅

---

## Phase 1 — Core betting loop (the MVP)

Goal: the whole game in its simplest form, on bulletproof data only.

- [x] `fixtures-sync` cron: pull WC fixtures + teams from football-data.org → `matches`, `teams`.
- [x] Fixtures UI: upcoming matches + recent results with kickoff times in local tz (Helsinki).
- [x] Bet slip (core only): Outcome + Exact Score. Locks at kickoff (UTC-checked server-side).
- [x] `settle` cron: detect finished matches, run settlement engine for core bets, write `ledger`, recompute balances, set `settled_at`.
- [x] Settlement engine as **pure, unit-tested functions** against saved fixture JSON (10 tests, all green).
- [x] Idempotency guard (unique ledger index + `settled_at` re-check).
- [x] Leaderboard (Glory; Coins also displayed).

**Done when:** you can predict a real match, it locks, and Glory updates automatically after full time without you touching anything. **This is the milestone that proves the concept.** ✅ Verified end-to-end with a synthetic test match via the dev endpoints.

---

## Phase 2 — Player props (goals & cards)

Goal: the prop layer, still on football-data.org only (no Sofascore yet).

- [ ] Squad/roster sync into `footballers` (after final squads confirmed ~June 1).
- [ ] `match_events` ingestion (goals, cards, own goals) in `settle`.
- [ ] Prop bets: First Goalscorer, Anytime Goalscorer, Carded. Pick up to 2.
- [ ] Void logic for players who didn't appear.
- [ ] Settlement extended for props.

**Done when:** "who scores first" bets settle correctly off real events, including the own-goal exclusion.

---

## Phase 3 — Coins + hybrid staking

Goal: the second currency and the staking mechanic.

- [ ] Coin income on settlement (participation, correct bets) → `ledger`.
- [ ] Balances UI (Glory + Coins).
- [ ] Optional stake attached to any bet at submission; settlement applies the multiplier / forfeits stake.
- [ ] ×3 total-multiplier cap enforced.

**Done when:** a staked correct bet pays amplified Glory, a staked wrong bet costs Coins, and balances reconcile against the ledger.

---

## Phase 4 — Stat Leader prop (Sofascore)

Goal: the granular layer, isolated behind an interface so its flakiness can't break settlement.

- [ ] `StatsProvider` interface; Sofascore adapter behind it.
- [ ] Team/player **ID mapping** (`sofa_*_id`) — the annoying plumbing; do it semi-manually for 48 squads.
- [ ] `player_match_stats` ingestion, post-match, rate-limited and try/caught.
- [ ] Stat Leader prop (passes/shots/touches); **void gracefully** if the feed fails.

**Done when:** a "most passes" bet settles when data exists and voids cleanly when it doesn't — and a Sofascore outage never blocks the rest of settlement.

---

## Phase 5 — Shop: power-ups, upgrades, sabotage

Goal: the strategic + PvP layer.

- [ ] Seed `shop_items` from `GAME_DESIGN.md` §6.
- [ ] Purchase flow (spend Coins → `manager_items`).
- [ ] Self power-ups applied in settlement (Double Down, Insurance, Hedge, Banker) + Crystal Ball pre-lock reveal.
- [ ] Permanent upgrades read into stake-cap / prop-slot / coin-multiplier calcs.
- [ ] Sabotage (Jinx, Mugging, Lockout, Fog of War, Curveball) + Ward counter.
- [ ] Knockout multipliers + Tax-the-Leader discount.

**Done when:** you can Jinx the leader before a big match and watch it bite at settlement, and a Ward blocks it.

---

## Phase 6 — Draft / auction (post-v1, optional)

Goal: the fantasy-style ownership layer. Only attempt if Phases 0–5 are solid and there's time before kickoff.

- [ ] `draft_picks` + a pre-tournament auction UI.
- [ ] Passive Glory for owned footballers/teams, computed as an extra step in settlement (reuses existing events + stats).

**Done when:** owning a hot striker earns you passive Glory every time they score, in matches you didn't even bet on.

---

## Cross-cutting (do throughout, not at the end)

- **Settlement tests** grow with every phase — this is where bugs hide. Save real fixture/stat JSON as test inputs.
- **Idempotency** re-checked whenever a new currency movement is added.
- **Timezones** in UTC server-side, local in UI, from day one.
- **Config-as-data**: keep all tunable numbers in `league.config`, not hardcoded.

---

## Suggested timeline anchor

| When | Target |
| --- | --- |
| Now → group draw known | Phases 0–1 (core loop on real fixtures) |
| Squad confirmation (~June 1) | Phases 2–3 (props + coins), start ID mapping |
| Pre-kickoff (June 11) | Phases 4–5 if time; otherwise launch on 0–3 and add live |
| During tournament | Phase 5 polish, maybe Phase 6 between matchdays |

Launching on Phases 0–3 by kickoff is a complete, fun game. Treat 4–6 as upgrades you can ship mid-tournament.
