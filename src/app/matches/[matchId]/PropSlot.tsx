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

export type PropType = 'first_scorer' | 'anytime_scorer' | 'carded';

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

export const PROP_META: Record<PropType, { label: string; hint: string; blurb: string }> = {
  first_scorer: { label: 'First goalscorer', hint: '+20 pts', blurb: 'Your player scores the match’s first goal (own goals excluded).' },
  anytime_scorer: { label: 'Anytime goalscorer', hint: '+10 pts', blurb: 'Your player scores at any point in the match.' },
  carded: { label: 'Booked', hint: '+10 pts', blurb: 'Your player gets a yellow or red card.' },
};

const PROP_ORDER: PropType[] = ['first_scorer', 'anytime_scorer', 'carded'];

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

// Relevance to the prop: forwards first for goals, defenders/mids first for cards.
function relevanceRank(cat: PosCat | null, kind: PropType): number {
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

interface SlotValue {
  type: PropType;
  playerId: string;
}

interface Props {
  squads: SlipSquads;
  defaultValue: SlotValue | null;
  locked: boolean;
  /** Notified whenever the chosen prop changes (for live previews). */
  onChange?: (value: SlotValue | null) => void;
}

export function PropSlot({ squads, defaultValue, locked, onChange }: Props) {
  const [value, setValue] = useState<SlotValue | null>(defaultValue);

  // Surface selection changes to the parent (max-winnings counter) without making
  // this a fully controlled component — the hidden input still drives submission.
  useEffect(() => {
    onChange?.(value);
  }, [value, onChange]);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'type' | 'player'>('type');
  const [pendingType, setPendingType] = useState<PropType | null>(null);
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

  function openModal() {
    setStep('type');
    setPendingType(null);
    setSearch('');
    setPosFilter('all');
    setOpen(true);
  }

  function chooseType(type: PropType) {
    setPendingType(type);
    setSearch('');
    setPosFilter('all');
    setStep('player');
  }

  function choosePlayer(playerId: string) {
    if (pendingType) setValue({ type: pendingType, playerId });
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

  const chosenPlayer = value ? playerById.get(value.playerId) : undefined;

  return (
    <>
      {/* Hidden field carries the slot into the form: name = prop type, value = footballer id */}
      {value && <input type="hidden" name={value.type} value={value.playerId} />}

      {value ? (
        <div className="space-y-2.5 rounded-2xl border border-border-strong bg-surface-2 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-points">{PROP_META[value.type].label}</p>
              <p className="truncate font-display text-sm font-semibold text-foreground">
                {chosenPlayer ? fmtPlayer(chosenPlayer) : 'Unknown player'}
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
                  aria-label="Change prop"
                  className="grid size-9 place-items-center rounded-xl text-subtle transition-colors hover:bg-[rgba(255,255,255,0.06)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <Pencil className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setValue(null)}
                  aria-label="Remove prop"
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
          No player bet.
        </p>
      ) : (
        <button
          type="button"
          onClick={openModal}
          className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2/40 px-4 py-5 font-display text-sm font-semibold text-muted transition-colors hover:border-[var(--color-primary-bright)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
        >
          <Plus className="size-5" aria-hidden />
          Add a player bet
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-0" showClose>
          {step === 'type' ? (
            <>
              <DialogTitle>Add a player bet</DialogTitle>
              <DialogDescription className="mt-1">Pick one prop to fill this slot.</DialogDescription>
              <div className="mt-4 space-y-2.5">
                {PROP_ORDER.map(type => {
                  const meta = PROP_META[type];
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => chooseType(type)}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-left transition-colors hover:border-[var(--color-primary-bright)] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                    >
                      <span className="min-w-0">
                        <span className="block font-display text-sm font-semibold text-foreground">{meta.label}</span>
                        <span className="block text-xs text-subtle">{meta.blurb}</span>
                      </span>
                      <span className="shrink-0 font-mono text-sm font-semibold text-points">{meta.hint}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep('type')}
                  aria-label="Back to prop types"
                  className="-ml-1 grid size-8 place-items-center rounded-full text-subtle transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary-bright)]"
                >
                  <ChevronLeft className="size-5" aria-hidden />
                </button>
                <DialogTitle>{pendingType ? PROP_META[pendingType].label : 'Choose a player'}</DialogTitle>
              </div>
              <DialogDescription className="sr-only">Choose a player for this prop.</DialogDescription>

              <div className="mt-4 flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" aria-hidden />
                  <Input
                    autoFocus
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
                                  onClick={() => choosePlayer(p.id)}
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
