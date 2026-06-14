'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, Pencil, Plus, Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Flag } from '@/components/ui/flag';
import { InfoTip } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import type { PlayerFormStats } from '@/lib/player-form';
import type { PlayerAvailability } from '@/types/db';
import {
  BONUS_BET_TYPES,
  BONUS_LABEL,
  isPlayerBonusBet,
  OVER_UNDER_LINE,
  type BonusBetType,
} from '@/lib/bonus-bets';

export interface SlipPlayer {
  id: string;
  name: string;
  squad_number: number | null;
  position: string | null;
  /** Tournament form (absent until the player's team has a settled match). */
  form?: PlayerFormStats;
  /** Hand-maintained injury flag — 'fit' (silent), 'doubtful' or 'out'. */
  availability?: PlayerAvailability;
  availability_note?: string | null;
}

export interface SlipSquads {
  homeTeam: string;
  awayTeam: string;
  homePlayers: SlipPlayer[];
  awayPlayers: SlipPlayer[];
}

// One-line "what it is" per market, shown under each option in the picker.
const BONUS_BLURB: Record<BonusBetType, string> = {
  first_scorer: 'Your player scores the match’s first goal (own goals excluded).',
  anytime_scorer: 'Your player scores at any point in the match.',
  score_2plus: 'Your player scores two or more goals.',
  anytime_assist: 'Your player assists a goal at any point in the match.',
  carded: 'Your player gets a yellow or red card.',
  over_under: `Total goals in the match, over or under ${OVER_UNDER_LINE}.`,
  clean_sheet: 'A team keeps a clean sheet (concedes no goals).',
};

// ─── position handling ─────────────────────────────────────────────────────────

type PosCat = 'GK' | 'DEF' | 'MID' | 'FWD';

// football-data positions range from coarse (Defence/Midfield/Offence) to fine
// (Centre-Back, Defensive Midfield, Right Winger…). Normalise to four buckets.
// Order matters: check "midfield" before "back/defen" so Defensive Midfield → MID.
function posCategory(position: string | null): PosCat | null {
  if (!position) return null;
  const p = position.toLowerCase();
  if (p.includes('keeper') || p === 'gk') return 'GK';
  if (p.includes('midfield') || p === 'mid') return 'MID';
  if (p.includes('back') || p.includes('defen')) return 'DEF';
  if (p.includes('forward') || p.includes('wing') || p.includes('striker') || p.includes('offen') || p.includes('attack')) return 'FWD';
  return null;
}

// Chips/badges use a fixed attacking-first order for consistency.
const CHIP_ORDER: PosCat[] = ['FWD', 'MID', 'DEF', 'GK'];

const POS_BADGE: Record<PosCat, string> = {
  GK: 'bg-[color-mix(in_oklab,var(--color-points)_22%,transparent)] text-points',
  DEF: 'bg-[color-mix(in_oklab,var(--color-primary-bright)_24%,transparent)] text-[var(--color-primary-bright)]',
  MID: 'bg-[color-mix(in_oklab,var(--color-success)_22%,transparent)] text-success',
  FWD: 'bg-[color-mix(in_oklab,var(--color-accent)_24%,transparent)] text-accent',
};

// Relevance to the market: defenders/mids first for cards, forwards first for goals
// and assists.
function relevanceRank(cat: PosCat | null, kind: BonusBetType): number {
  const order: PosCat[] = kind === 'carded' ? ['DEF', 'MID', 'FWD', 'GK'] : ['FWD', 'MID', 'DEF', 'GK'];
  const i = cat ? order.indexOf(cat) : -1;
  return i === -1 ? order.length : i; // unknown position sinks to the bottom
}

// Players set to miss the match sink below everyone else — still pickable
// (the news can be wrong), just clearly a long shot.
function missingRank(p: SlipPlayer): number {
  return p.availability === 'out' || p.form?.suspended ? 1 : 0;
}

// One compact mono token per stat — zeroes stay silent so quiet rows stay quiet.
function formTokens(form: PlayerFormStats): string {
  const bits = [`${form.apps}M`];
  if (form.goals > 0) bits.push(`⚽${form.goals}`);
  if (form.yellows > 0) bits.push(`🟨${form.yellows}`);
  if (form.reds > 0) bits.push(`🟥${form.reds}`);
  return bits.join(' ');
}

// One status badge per row, worst news wins: ruled out > suspended > doubtful.
// Fit players show form tokens instead (handled at the call site).
function statusBadge(p: SlipPlayer): { label: string; cls: string } | null {
  if (p.availability === 'out')
    return { label: 'OUT', cls: 'bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] text-danger' };
  if (p.form?.suspended)
    return { label: 'SUSP', cls: 'bg-[color-mix(in_oklab,var(--color-danger)_18%,transparent)] text-danger' };
  if (p.availability === 'doubtful')
    return { label: 'DOUBT', cls: 'bg-[color-mix(in_oklab,var(--color-accent)_20%,transparent)] text-accent' };
  return null;
}

// Warning line under a chosen player — mirrors the badge precedence and folds in
// the hand-written note ("hamstring", "withdrawn from squad"…) when there is one.
function statusWarning(p: SlipPlayer): { text: string; cls: string } | null {
  const note = p.availability_note ? ` — ${p.availability_note}` : '';
  if (p.availability === 'out') return { text: `Ruled out${note}`, cls: 'text-danger' };
  if (p.form?.suspended) return { text: 'Suspended — set to miss this match', cls: 'text-danger' };
  if (p.availability === 'doubtful') return { text: `Doubtful${note}`, cls: 'text-accent' };
  return null;
}

// The slot's value: a market plus its parameter. `value` is a footballer id for the
// player markets, 'over'/'under' for over_under, or 'home'/'away' for clean_sheet.
export interface BonusSlotValue {
  type: BonusBetType;
  value: string;
}

interface Props {
  squads: SlipSquads;
  defaultValue: BonusSlotValue | null;
  locked: boolean;
  /** Points per market, for the picker hint (sourced from live config, never hardcoded). */
  points: Record<BonusBetType, number>;
  /** Notified whenever the chosen bonus bet changes (drives the live max-winnings counter). */
  onChange?: (value: BonusSlotValue | null) => void;
}

export function BonusSlot({ squads, defaultValue, locked, points, onChange }: Props) {
  const [value, setValue] = useState<BonusSlotValue | null>(defaultValue);

  // Surface selection changes to the parent (max-winnings counter) without making
  // this a fully controlled component — the hidden inputs still drive submission.
  useEffect(() => {
    onChange?.(value);
  }, [value, onChange]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'type' | 'player' | 'param'>('type');
  const [pendingType, setPendingType] = useState<BonusBetType | null>(null);
  const [search, setSearch] = useState('');
  const [posFilter, setPosFilter] = useState<PosCat | 'all'>('all');

  const allPlayers = useMemo(
    () => [...squads.homePlayers, ...squads.awayPlayers],
    [squads],
  );
  const playerById = useMemo(() => {
    const map = new Map<string, SlipPlayer>();
    for (const p of allPlayers) map.set(p.id, p);
    return map;
  }, [allPlayers]);

  // Which position chips to offer — only categories actually present in the squads.
  const presentCats = useMemo(() => {
    const set = new Set<PosCat>();
    for (const p of allPlayers) {
      const c = posCategory(p.position);
      if (c) set.add(c);
    }
    return CHIP_ORDER.filter(c => set.has(c));
  }, [allPlayers]);
  const hasPositions = presentCats.length > 0;

  const fmtPlayer = (p: SlipPlayer) => (p.squad_number != null ? `${p.squad_number}. ${p.name}` : p.name);

  // Human-readable detail for a chosen bonus bet (player name, the O/U side, or team).
  function detailOf(v: BonusSlotValue): string {
    if (isPlayerBonusBet(v.type)) {
      const p = playerById.get(v.value);
      return p ? fmtPlayer(p) : 'Unknown player';
    }
    if (v.type === 'over_under') return `${v.value === 'over' ? 'Over' : 'Under'} ${OVER_UNDER_LINE} goals`;
    if (v.type === 'clean_sheet') return v.value === 'home' ? squads.homeTeam : squads.awayTeam;
    return '';
  }

  function openModal() {
    setStep('type');
    setPendingType(null);
    setSearch('');
    setPosFilter('all');
    setOpen(true);
  }

  function chooseType(type: BonusBetType) {
    setPendingType(type);
    setSearch('');
    setPosFilter('all');
    setStep(isPlayerBonusBet(type) ? 'player' : 'param');
  }

  function commit(type: BonusBetType, val: string) {
    setValue({ type, value: val });
    setOpen(false);
  }

  const q = search.trim().toLowerCase();

  // Pipeline per team: search filter → position-chip filter → relevance sort.
  const prepare = (players: SlipPlayer[]) => {
    const searched = q ? players.filter(p => p.name.toLowerCase().includes(q)) : players;
    const filtered = posFilter === 'all' ? searched : searched.filter(p => posCategory(p.position) === posFilter);
    if (!pendingType) return [...filtered].sort((a, b) => missingRank(a) - missingRank(b));
    return [...filtered].sort(
      (a, b) =>
        missingRank(a) - missingRank(b) ||
        relevanceRank(posCategory(a.position), pendingType) - relevanceRank(posCategory(b.position), pendingType),
    );
  };
  const homeMatches = prepare(squads.homePlayers);
  const awayMatches = prepare(squads.awayPlayers);
  const noMatches = homeMatches.length === 0 && awayMatches.length === 0;

  // Chip counts reflect the current search (but not the chip filter itself).
  const searchCount = (cat: PosCat | 'all') =>
    allPlayers.filter(p => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return cat === 'all' || posCategory(p.position) === cat;
    }).length;

  const chosenPlayer = value && isPlayerBonusBet(value.type) ? playerById.get(value.value) : undefined;

  // The two options offered on the non-player param step.
  const paramOptions: { value: string; label: string }[] =
    pendingType === 'over_under'
      ? [
          { value: 'over', label: `Over ${OVER_UNDER_LINE} goals` },
          { value: 'under', label: `Under ${OVER_UNDER_LINE} goals` },
        ]
      : pendingType === 'clean_sheet'
        ? [
            { value: 'home', label: `${squads.homeTeam} clean sheet` },
            { value: 'away', label: `${squads.awayTeam} clean sheet` },
          ]
        : [];

  return (
    <>
      {/* Hidden fields carry the slot into the form: market type + its parameter. */}
      {value && (
        <>
          <input type="hidden" name="bonus_type" value={value.type} />
          <input type="hidden" name="bonus_value" value={value.value} />
        </>
      )}

      {value ? (
        <div className="space-y-2.5 rounded-2xl border border-border-strong bg-surface-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-points">{BONUS_LABEL[value.type]}</p>
              <p className="truncate font-display text-sm font-semibold text-foreground">
                {detailOf(value)}
              </p>
              {(() => {
                const warning = chosenPlayer && statusWarning(chosenPlayer);
                return warning ? <p className={`text-xs font-medium ${warning.cls}`}>{warning.text}</p> : null;
              })()}
            </div>
            {!locked && (
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={openModal}
                  aria-label="Change bonus bet"
                  className="grid size-9 place-items-center rounded-xl text-subtle transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setValue(null)}
                  aria-label="Remove bonus bet"
                  className="grid size-9 place-items-center rounded-xl text-subtle transition-colors hover:bg-[color-mix(in_oklab,var(--color-danger)_16%,transparent)] hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>
      ) : locked ? (
        <p className="rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm text-subtle">
          No bonus bet.
        </p>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2/40 px-4 py-5 font-display text-sm font-semibold text-muted transition-colors hover:border-[var(--color-primary-bright)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
        >
          <Plus className="size-5" aria-hidden />
          Add a bonus bet
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0" showClose>
          {step === 'type' ? (
            <>
              <DialogTitle>Add a bonus bet</DialogTitle>
              <DialogDescription className="mt-1">Pick one bonus bet to fill this slot.</DialogDescription>
              <div className="-mr-2 mt-4 max-h-[60vh] space-y-2.5 overflow-y-auto pr-2">
                {BONUS_BET_TYPES.map(type => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => chooseType(type)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-left transition-colors hover:border-[var(--color-primary-bright)] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                  >
                    <span className="min-w-0">
                      <span className="block font-display text-sm font-semibold text-foreground">{BONUS_LABEL[type]}</span>
                      <span className="block text-xs text-subtle">{BONUS_BLURB[type]}</span>
                    </span>
                    <span className="shrink-0 font-mono text-sm font-semibold text-points">+{points[type]} pts</span>
                  </button>
                ))}
              </div>
            </>
          ) : step === 'param' ? (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('type')}
                  aria-label="Back to bonus bets"
                  className="-ml-1 grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <DialogTitle>{pendingType ? BONUS_LABEL[pendingType] : 'Choose'}</DialogTitle>
              </div>
              <DialogDescription className="sr-only">Choose an option for this bonus bet.</DialogDescription>
              <div className="mt-4 space-y-2.5">
                {paramOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => pendingType && commit(pendingType, opt.value)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3.5 text-left font-display text-sm font-semibold text-foreground transition-colors hover:border-[var(--color-primary-bright)] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                  >
                    {pendingType === 'clean_sheet' && (
                      <Flag name={opt.value === 'home' ? squads.homeTeam : squads.awayTeam} size="md" />
                    )}
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('type')}
                  aria-label="Back to bonus bets"
                  className="-ml-1 grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <DialogTitle>{pendingType ? BONUS_LABEL[pendingType] : 'Choose a player'}</DialogTitle>
              </div>
              <DialogDescription className="sr-only">Choose a player for this bonus bet.</DialogDescription>

              <div className="mt-4 flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <Input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search players…"
                    className="pl-9"
                    aria-label="Search players"
                  />
                </div>
                <InfoTip label="What do the player stats mean?">
                  Form at this World Cup: <span className="font-mono text-foreground">2M</span> = played 2
                  matches, <span className="font-mono text-foreground">⚽</span> goals scored (penalties
                  count, own goals don&rsquo;t), <span className="font-mono text-foreground">🟨 🟥</span>{' '}
                  cards. <span className="font-mono font-bold text-danger">SUSP</span> = suspended for this
                  match after a red card or two yellows.{' '}
                  <span className="font-mono font-bold text-danger">OUT</span> = injured or withdrawn from
                  the squad. <span className="font-mono font-bold text-accent">DOUBT</span> = fitness doubt
                  per latest team news.
                </InfoTip>
              </div>

              {hasPositions && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {(['all', ...presentCats] as const).map(cat => {
                    const active = posFilter === cat;
                    const label = cat === 'all' ? 'All' : cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPosFilter(cat)}
                        aria-pressed={active}
                        className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                          active
                            ? 'border-[var(--color-primary-bright)] bg-[color-mix(in_oklab,var(--color-primary-bright)_18%,transparent)] text-foreground'
                            : 'border-border bg-surface-2 text-subtle hover:border-border-strong hover:text-muted'
                        }`}
                      >
                        {label}
                        <span className="ml-1.5 font-mono text-[0.65rem] text-subtle">{searchCount(cat)}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="-mr-2 mt-3 flex-1 overflow-y-auto pr-2">
                {noMatches ? (
                  <p className="py-8 text-center text-sm text-subtle">No players match your filters.</p>
                ) : (
                  <div className="space-y-4">
                    {[
                      { team: squads.homeTeam, players: homeMatches },
                      { team: squads.awayTeam, players: awayMatches },
                    ].map(group =>
                      group.players.length === 0 ? null : (
                        <div key={group.team}>
                          <p className="sticky top-0 flex items-center gap-1.5 bg-surface/95 py-1 text-xs font-semibold uppercase tracking-wider text-subtle backdrop-blur">
                            <Flag name={group.team} size="sm" />
                            {group.team}
                          </p>
                          <div className="space-y-1">
                            {group.players.map(p => {
                              const cat = posCategory(p.position);
                              const badge = statusBadge(p);
                              return (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => pendingType && commit(pendingType, p.id)}
                                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                                >
                                  <span className="w-7 shrink-0 text-center font-mono text-xs text-subtle">
                                    {p.squad_number ?? '—'}
                                  </span>
                                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                                  {badge ? (
                                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] font-bold ${badge.cls}`}>
                                      {badge.label}
                                    </span>
                                  ) : (
                                    p.form && (
                                      <span className="shrink-0 font-mono text-[0.65rem] tabular-nums text-subtle">
                                        {formTokens(p.form)}
                                      </span>
                                    )
                                  )}
                                  {cat && (
                                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[0.65rem] font-bold ${POS_BADGE[cat]}`}>
                                      {cat}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
