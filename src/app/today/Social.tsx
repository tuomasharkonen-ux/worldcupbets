'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Film,
  Loader2,
  MessagesSquare,
  Search,
  Send,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Flag } from '@/components/ui/flag';
import { cn } from '@/lib/utils';
import { REACTION_EMOJIS, MAX_COMMENT_CHARS } from '@/lib/social';
import { deleteComment, postComment, toggleReaction } from './actions';

// ─── data shapes (built server-side in social-data.ts, mocked in /admin) ───────

export interface ReactionChipData {
  emoji: string;
  count: number;
  /** The viewer has this reaction (tapping removes it). */
  mine: boolean;
  /** Display names of everyone behind the count, for the tooltip. */
  names: string[];
}

export interface SlipRowData {
  managerId: string;
  name: string;
  avatar: string;
  isYou: boolean;
  score: { home: number; away: number } | null;
  /** Resolved outcome label — a team name or 'Draw'. */
  outcome: string | null;
  mult: number;
  prop: { label: string; detail: string } | null;
}

export interface SlipMatchData {
  id: string;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  kickoff: string; // ISO UTC
  rows: SlipRowData[];
}

export interface FeedCommentData {
  id: string;
  managerId: string;
  name: string;
  avatar: string;
  isYou: boolean;
  body: string;
  gifUrl: string | null;
  createdAt: string; // ISO UTC
  reactions: ReactionChipData[];
}

export interface SocialData {
  slateKey: string;
  matches: SlipMatchData[];
  comments: FeedCommentData[];
  gifsEnabled: boolean;
}

const TIMEZONE = 'Europe/Helsinki';

function formatKickoff(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

function formatCommentTime(utc: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(utc));
}

// How often the feed re-pulls server data while the tab is visible. Server
// actions already refresh the page for your own posts/reactions; this is only
// for catching everyone else's. Kept deliberately slow (and gated by `poll`,
// below) because each refresh re-queries Supabase for everyone's bets + the
// comment feed — on a busy match day with many open tabs that is the single
// biggest source of database egress.
const POLL_MS = 60_000;

// ─── root ───────────────────────────────────────────────────────────────────────

export function Social({
  data,
  preview = false,
  poll = true,
}: {
  data: SocialData;
  preview?: boolean;
  /** Keep polling for others' activity. The page turns this off once the slate is
   *  fully settled — the feed is frozen at that point and the recap takes over, so
   *  there's nothing new to fetch and no reason to keep hitting the database. */
  poll?: boolean;
}) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  // One reaction picker open at a time, keyed by comment id.
  const [openPicker, setOpenPicker] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (preview || !poll) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [preview, poll, router]);

  const react = (emoji: string, commentId: string) => {
    setOpenPicker(null);
    if (preview) return;
    startTransition(async () => {
      await toggleReaction({ emoji, commentId });
    });
  };

  return (
    <>
      {/* Pure information — no interactive elements, so no cards: plain rows on
          the page background, like the betting-state match list. */}
      <section className="space-y-4 pt-4">
        <h2 className="px-1 text-[0.7rem] font-semibold uppercase tracking-wider text-subtle">
          Everyone’s bets
        </h2>
        {data.matches.map(m => (
          <SlipMatchOverview key={m.id} match={m} />
        ))}
      </section>

      <section className="space-y-3 pt-4">
        {/* Mirrors the page-header pattern (icon + display title + kicker) so the
            feed reads as its own destination, not another list label. */}
        <div className="flex items-center gap-2.5">
          <MessagesSquare className="size-6 text-primary-bright" aria-hidden />
          <div>
            <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">Banter</h2>
            <p className="text-xs text-subtle">Trash talk encouraged — GIFs welcome</p>
          </div>
        </div>
        <Card variant="glass" padding="sm">
          <CommentsFeed
            data={data}
            preview={preview}
            openPicker={openPicker}
            setOpenPicker={setOpenPicker}
            onReact={react}
          />
        </Card>
      </section>
    </>
  );
}

// ─── reactions ──────────────────────────────────────────────────────────────────

// Existing reactions as tappable count chips (tap = toggle that emoji). Sized for
// thumbs: 36px tall with breathing room between chips.
function Chips({ chips, onPick }: { chips: ReactionChipData[]; onPick: (emoji: string) => void }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {chips.map(c => (
        <button
          key={c.emoji}
          type="button"
          onClick={() => onPick(c.emoji)}
          title={c.names.join(', ')}
          aria-label={`${c.emoji} ${c.count} — ${c.names.join(', ')}`}
          aria-pressed={c.mine}
          className={cn(
            'flex h-9 touch-manipulation select-none items-center gap-1.5 rounded-full px-3 text-sm tabular-nums transition-colors',
            c.mine
              ? 'bg-primary/25 text-foreground shadow-[inset_0_0_0_1px_var(--color-primary-bright)]'
              : 'bg-surface-2 text-muted active:text-foreground hover:text-foreground',
          )}
        >
          <span className="text-base leading-none" aria-hidden>{c.emoji}</span>
          {c.count}
        </button>
      ))}
    </div>
  );
}

// Round 40px icon button — the smallest touch target the social UI uses.
function IconAction({
  label,
  expanded,
  onClick,
  children,
}: {
  label: string;
  expanded?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      className={cn(
        'flex size-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-subtle transition-colors',
        'hover:bg-surface-2 hover:text-foreground active:bg-surface-2 active:text-foreground',
        expanded && 'bg-surface-2 text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// The emoji palette, rendered in-flow (full width, under whatever it reacts to)
// rather than as a floating popover — no clipping or fat-finger misses on mobile;
// each of the six emojis gets an equal ~44px-tall slice of the row.
function EmojiBar({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="flex gap-1 rounded-2xl bg-surface-2 p-1.5">
      {REACTION_EMOJIS.map(e => (
        <button
          key={e}
          type="button"
          aria-label={`React ${e}`}
          onClick={() => onPick(e)}
          className="flex h-11 flex-1 touch-manipulation select-none items-center justify-center rounded-xl text-2xl transition-[background-color,transform] duration-100 hover:bg-surface-3 active:scale-110"
        >
          {e}
        </button>
      ))}
    </div>
  );
}

// ─── everyone's bets ───────────────────────────────────────────────────────────

// Read-only digest of one match's slips: one tight line per manager — name,
// outcome, stake multiplier, called score — with any player prop tucked under it.
function SlipMatchOverview({ match }: { match: SlipMatchData }) {
  return (
    <div className="px-1">
      <div className="flex items-center justify-between gap-2 pb-1">
        <span className="flex min-w-0 items-center gap-1.5 font-display text-sm font-semibold text-foreground">
          <Flag name={match.home} countryCode={match.homeCode} size="sm" />
          <span className="truncate">{match.home}</span>
          <span className="text-xs font-normal text-subtle">vs</span>
          <span className="truncate">{match.away}</span>
          <Flag name={match.away} countryCode={match.awayCode} size="sm" />
        </span>
        <span className="shrink-0 text-xs text-subtle">{formatKickoff(match.kickoff)}</span>
      </div>

      <div className="divide-y divide-border">
        {match.rows.map(row => (
          <div key={row.managerId} className="space-y-0.5 py-2">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none" aria-hidden>{row.avatar}</span>
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-sm font-medium',
                  row.isYou ? 'text-primary-bright' : 'text-foreground',
                )}
              >
                {row.isYou ? 'You' : row.name}
              </span>
              {row.score ? (
                <>
                  {row.mult > 1 && <Badge variant="points" size="sm">×{row.mult}</Badge>}
                  <span className="max-w-32 truncate text-xs text-muted">{row.outcome}</span>
                  <span className="w-12 rounded-md bg-surface-2 px-2 py-0.5 text-center font-mono text-sm font-bold tabular-nums text-foreground">
                    {row.score.home}–{row.score.away}
                  </span>
                </>
              ) : (
                <span className="text-xs italic text-subtle">No bet yet</span>
              )}
            </div>
            {row.prop && (
              <p className="pl-6 text-xs text-subtle">
                {row.prop.label}: <span className="text-muted">{row.prop.detail}</span>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── comments feed ─────────────────────────────────────────────────────────────

function CommentsFeed({
  data,
  preview,
  openPicker,
  setOpenPicker,
  onReact,
}: {
  data: SocialData;
  preview: boolean;
  openPicker: string | null;
  setOpenPicker: (id: string | null) => void;
  onReact: (emoji: string, commentId: string) => void;
}) {
  const [isDeleting, startDelete] = React.useTransition();

  const remove = (id: string) => {
    if (preview) return;
    if (!window.confirm('Delete this comment?')) return;
    startDelete(async () => {
      await deleteComment(id);
    });
  };

  return (
    <div className="space-y-1">
      {data.comments.length === 0 ? (
        <p className="px-1 py-3 text-center text-sm text-subtle">
          No banter yet — start it off.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {data.comments.map(c => {
            const pickerId = `comment:${c.id}`;
            const pickerOpen = openPicker === pickerId;
            return (
              <div key={c.id} className="flex gap-2.5 py-2.5">
                <span className="pt-1 text-base leading-none" aria-hidden>{c.avatar}</span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        c.isYou ? 'text-primary-bright' : 'text-foreground',
                      )}
                    >
                      {c.isYou ? 'You' : c.name}
                    </span>
                    <span className="text-xs text-subtle">{formatCommentTime(c.createdAt)}</span>
                    {c.isYou && (
                      // Visually small, but a 40px hit area (negative margins keep the
                      // header line from growing).
                      <button
                        type="button"
                        aria-label="Delete comment"
                        disabled={isDeleting}
                        onClick={() => remove(c.id)}
                        className="-my-2 ml-auto flex size-10 touch-manipulation items-center justify-center rounded-full text-subtle transition-colors hover:text-danger active:text-danger disabled:opacity-50"
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    )}
                  </div>
                  {c.body && (
                    <p className="whitespace-pre-wrap break-words text-sm text-foreground">{c.body}</p>
                  )}
                  {c.gifUrl && (
                    // Giphy media URLs are dynamic and short-lived enough that the Next.js
                    // image optimizer adds nothing — render them directly.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.gifUrl}
                      alt="GIF"
                      loading="lazy"
                      className="max-h-48 rounded-xl"
                    />
                  )}
                  <div className="flex items-center gap-1.5">
                    <Chips chips={c.reactions} onPick={emoji => onReact(emoji, c.id)} />
                    <IconAction
                      label="React to comment"
                      expanded={pickerOpen}
                      onClick={() => setOpenPicker(pickerOpen ? null : pickerId)}
                    >
                      <SmilePlus className="size-5" aria-hidden />
                    </IconAction>
                  </div>
                  {pickerOpen && <EmojiBar onPick={emoji => onReact(emoji, c.id)} />}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Composer slateKey={data.slateKey} gifsEnabled={data.gifsEnabled} preview={preview} />
    </div>
  );
}

// ─── composer ──────────────────────────────────────────────────────────────────

interface GifResult {
  id: string;
  url: string;
  preview: string;
  alt: string;
}

function Composer({
  slateKey,
  gifsEnabled,
  preview,
}: {
  slateKey: string;
  gifsEnabled: boolean;
  preview: boolean;
}) {
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const [body, setBody] = React.useState('');
  const [gif, setGif] = React.useState<GifResult | null>(null);
  const [gifPanelOpen, setGifPanelOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [isPosting, startPost] = React.useTransition();

  const canSend = !isPosting && (body.trim().length > 0 || gif !== null);

  const send = () => {
    if (!canSend || preview) return;
    setError(null);
    startPost(async () => {
      const result = await postComment({
        slateKey,
        body,
        gifUrl: gif?.url ?? null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setBody('');
      setGif(null);
      setGifPanelOpen(false);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    });
  };

  return (
    <div className="space-y-2 border-t border-border pt-3">
      {gif && (
        <div className="relative inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gif.preview || gif.url} alt={gif.alt} className="max-h-28 rounded-xl" />
          <button
            type="button"
            aria-label="Remove GIF"
            onClick={() => setGif(null)}
            className="absolute -right-2.5 -top-2.5 flex size-9 touch-manipulation items-center justify-center rounded-full bg-surface-3 text-foreground shadow"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={body}
          rows={1}
          maxLength={MAX_COMMENT_CHARS}
          placeholder="Say something…"
          enterKeyHint="send"
          onChange={e => {
            setBody(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          // text-base (16px), not text-sm — iOS Safari auto-zooms the page when
          // focusing any input with a computed font-size below 16px.
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-base text-foreground placeholder:text-subtle focus:outline-2 focus:outline-offset-1 focus:outline-[var(--color-primary-bright)]"
        />
        {gifsEnabled && (
          <Button
            type="button"
            variant="glass"
            size="icon"
            aria-label="Add a GIF"
            aria-expanded={gifPanelOpen}
            onClick={() => setGifPanelOpen(o => !o)}
          >
            <Film aria-hidden />
          </Button>
        )}
        <Button
          type="button"
          variant="primary"
          size="icon"
          aria-label="Send"
          disabled={!canSend}
          onClick={send}
        >
          {isPosting ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
        </Button>
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      {gifPanelOpen && !gif && (
        <GifPanel
          onPick={g => {
            setGif(g);
            setGifPanelOpen(false);
          }}
        />
      )}
    </div>
  );
}

function GifPanel({ onPick }: { onPick: (gif: GifResult) => void }) {
  const [query, setQuery] = React.useState('');
  const [gifs, setGifs] = React.useState<GifResult[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Debounced search; empty query shows trending. Previous results stay on screen
  // during the debounce window; the spinner only kicks in once the fetch starts.
  React.useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      if (cancelled) return;
      setLoading(true);
      try {
        const res = await fetch(`/api/gifs?q=${encodeURIComponent(query.trim())}`);
        const json: { gifs?: GifResult[] } = await res.json();
        if (!cancelled) setGifs(json.gifs ?? []);
      } catch {
        if (!cancelled) setGifs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-2">
      <div className="flex items-center gap-2 rounded-lg bg-surface-3 px-3">
        <Search className="size-4 shrink-0 text-subtle" aria-hidden />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search GIFs…"
          aria-label="Search GIFs"
          // 16px text so iOS Safari doesn't zoom the page on focus.
          className="h-11 w-full bg-transparent text-base text-foreground placeholder:text-subtle focus:outline-none"
        />
      </div>
      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-subtle" aria-hidden />
        </div>
      ) : gifs.length === 0 ? (
        <p className="py-4 text-center text-xs text-subtle">No GIFs found.</p>
      ) : (
        <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto overscroll-contain">
          {gifs.map(g => (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g)}
              className="touch-manipulation overflow-hidden rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--color-primary-bright)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.preview || g.url} alt={g.alt} loading="lazy" className="h-24 w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="text-right text-[0.6rem] text-subtle">Powered by GIPHY</p>
    </div>
  );
}
