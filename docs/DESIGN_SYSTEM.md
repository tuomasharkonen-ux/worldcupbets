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

- **Fredoka** → `font-display` — rounded, bubbly; headings + wordmark.
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
