# Design system

Bold & playful, on a dark indigo-navy canvas: chunky 3D controls, glassmorphic
surfaces, large radii, rounded display type, and a real icon set. Tuned for
**WCAG AA** contrast throughout.

## Foundations

### Tokens (`src/app/globals.css`)

All colours, radii, and fonts are semantic CSS variables declared in the
Tailwind v4 `@theme` block. **Build new UI on these tokens, not raw `zinc-*`
shades** — retuning the whole look then means editing one file.

| Token | Use | Notes |
|-------|-----|-------|
| `background` `surface` `surface-2` `surface-3` | canvas → raised → pressed | dark, indigo-tinted |
| `border` `border-strong` | hairlines | translucent white, sit on any surface |
| `foreground` `muted` `subtle` | text tiers | all ≥ 4.5:1 on bg/surface (AA) |
| `primary` `primary-hover` `primary-press` `primary-bright` | actions, 3D lip, glow/focus | white-on-`primary` ≈ 5.6:1 |
| `accent` / `accent-press` | playful pink — decorative & sabotage | use dark text on it, not white |
| `points` / `points-press` | Points (gold) | dark text on gold fills |
| `success` `danger` | bet/result status | used as text on dark |
| `radius-lg…3xl` | 1rem → 2rem | bubbly; controls use `2xl` |

Contrast is verifiable: every text/bg pair was checked against the WCAG formula.
When adding a token used for text, keep it ≥ 4.5:1 (normal) or ≥ 3:1 (large/icon).

### Utilities

- `glass` / `glass-strong` — frosted panels (`backdrop-blur` + translucent
  surface + inset top highlight). They read as glass because the `body` paints
  soft colour blobs behind everything.
- `text-glow` — subtle primary glow for hero headings.
- A single global `:focus-visible` ring (primary-bright) — do not remove it.
- `prefers-reduced-motion` is respected globally.

### Fonts (`src/app/layout.tsx`, via `next/font/google`)

- **Carter One** → `font-display` — rounded, bubbly; headings + wordmark. Single weight (400); bolder display text is synthesised.
- **Plus Jakarta Sans** → `font-sans` — body / UI default.
- **Geist Mono** → `font-mono` — scores & numerics (`tabular-nums`).

## Components (`src/components/ui/`)

Headless-ish primitives styled with [CVA](https://cva.style) + the `cn()` helper
(`src/lib/utils.ts`). All presentational (usable from server or client components).

- **`Button`** — the chunky 3D control. Depth is a hard-edged coloured
  box-shadow "lip"; `:active` drops into it (`translate-y`). Variants:
  `primary` · `points` · `accent` · `glass` · `ghost`. Sizes: `sm` `md` `lg`
  `icon`. `asChild` (Radix Slot) to render as a `Link`. Auto-flattens when
  `disabled`.
- **`Card`** — `glass` (default) · `solid` · `well`, with `padding` scale.
  `CardTitle` for headings.
- **`Badge`** — pill, status-coloured (translucent tint + matching text):
  `open` · `locked` · `finished` · `points` · `primary` · `neutral`.
- **`Input`** — inset well; lifts to a bright focus ring.

Icons: **lucide-react** everywhere (no emojis). Decorative icons get
`aria-hidden`; icon-only controls get `aria-label`.

## Conventions

- Reach for a `ui/` component before hand-rolling; reach for a token before a
  raw colour.
- Status semantics are fixed: green = open/won, red = locked/lost, gold =
  Points, violet = the user / primary action.
- New phases (props, coins, shop, draft) should compose these primitives. Add a
  new `ui/` component only when a pattern repeats; add a token when a new
  semantic colour appears (e.g. a distinct "sabotage" treatment beyond `accent`).

## Motion & flare (Phase 3)

Phase 3 (the daily-game overhaul) adds **ambient interactive flare** and **reactive
reveal motion**. Both decorate the existing primitives — no new colour unless a new
semantic appears.

### Rules (non-negotiable)

- **`prefers-reduced-motion` is sacred** (already global). Every effect has a static
  or near-static fallback; ambient/cursor effects simply don't mount.
- **60fps or it doesn't ship** — animate only `transform` / `opacity` / CSS custom
  properties; never layout properties.
- **Budget**: cursor/scroll listeners are RAF-throttled and *delegated* (one listener,
  not one per card); ambient effects disable on coarse pointers (touch).
- Tokens-first: reflections/glows read from `border-strong` / `primary-bright`.

### Ambient glass flare — the cards that "live"

A reusable `<GlassFlare>` wrapper / `useGlassFlare` hook (lives alongside the `glass`
utility), opt-in per card, trivially disabled:

- **Cursor edge reflection** — track pointer position relative to the card
  (`--mx`/`--my`, 0–1), render a soft radial highlight + a brighter border segment
  following the cursor, like light glancing off real glass. `::before`/`::after`
  gradient masked to the border, opacity driven by proximity.
- **Scroll-reactive sheen** — a faint sheen sweeps across glass as cards move through
  the viewport (`IntersectionObserver` + scroll progress). Subtle: "the light
  shifted," not a disco.
- **Tilt (optional, small)** — a few degrees of parallax tilt toward the cursor on
  hero cards; capped to avoid nausea; off on touch.

> Doable in vanilla CSS vars + a tiny hook — likely no new dependency. If the recap
> wants spring physics, `motion` (Framer Motion) is the natural add — decide at
> implementation time.

### The morning recap — the showcase choreography

The signature moment (see `GAME_DESIGN.md` §2 / the daily loop). A **sequenced,
tap-to-advance reveal** (auto-advances ~1.5s, always skippable):

1. **"Last night"** title card — slate date, held breath; blobs pulse.
2. **Match-by-match** — each match reveals in turn: score counts up, pick stamps
   **HIT** (green pop + confetti) / **MISS** (muted red shake); staked chips ignite or
   burn.
3. **Points odometer** — running total rolls up with `+10` / `×1.5 stake` / `×2.0 stage`
   chips flying in; overshoot-and-settle; `text-glow` flares.
4. **Coins cascade** — coins rain into balance, itemised (participation, correct,
   clean-slate, streak, interest); streak flame grows.
5. **Leaderboard FLIP** — rows animate to new positions; your row highlighted, ▲/▼
   deltas slide in; overtaking a rival celebrates (gently honest on being overtaken).
6. **Shop CTA** — "You have **140¢** to spend." Balance pulses; chunky `Button`
   bounces in.

Principles: **earned not instant** (numbers *travel*, so a good night feels bigger),
**skippable** (persistent *Skip →*; re-viewing shows the static end-state), **honest
but kind** (dopamine loaded on wins, never humiliating). Reduced-motion path renders
the same beats as an instant static summary. Data is cheap — a read over the slate's
`ledger` + bet statuses + a yesterday-vs-today leaderboard snapshot; all the cost is
front-end choreography.

### The Today screen — one screen, four states

`/today` is a single screen that progresses through the daily loop. The recap is the
final state of the *same* surface, not a separate page.

1. **Betting** (default, before you've saved a full slip) — the slate's matches as
   bettable cards; build your slip + stakes; shop entry point.
2. **You're all set** (slip submitted) — a confirmation variant showing your submitted
   bets per match, a countdown to first kickoff, and your coins/shop access. Bets stay
   editable until each match's own kickoff lock (power-ups + Accumulator lock at the
   slate's first kickoff). This is the "come back tonight" resting state.
3. **Settling / waiting for results** — from the moment the slate's **last match has
   kicked off** (nothing is editable any more) until the whole slate is settled. The
   screen flips to recap mode but shows a clear **"Results are still coming in — check
   back soon"** state instead of the celebration. Settlement is a multi-run sweep
   (06:00–10:00 Helsinki), so this state can persist for a while; it must read as
   *expected*, not broken. Show **progress only** (e.g. "3 of 5 settled") — the actual
   results, points, and coins stay **hidden** so the full reveal lands all at once. No
   peeking at individual outcomes during the wait.
4. **Recap ready** — once **every** match on the slate has `settled_at`, the full
   sequenced reveal (below) unlocks. The recap stays **pending per manager** until they
   dismiss it with "Next match day" (`managers.state.recap_seen_slate`), so it survives
   the 09:00 slate rollover — settlement landing late just means you see it on your
   next visit instead of never.

"Ready" is a data condition (all slate matches settled), not just a clock time — a match
still in play or awaiting data keeps the screen in state 3 rather than revealing a
half-finished recap.

### Reveal/feedback motion toolkit

Count-up odometers · scaled confetti/particle bursts (sized to the win) · FLIP list
reorders · chunky-button bounce · stake-chip "ka-ching" micro-bounce · power-up
"charging" the bet at reveal. Optional opt-in, muted-by-default SFX — never autoplay.
