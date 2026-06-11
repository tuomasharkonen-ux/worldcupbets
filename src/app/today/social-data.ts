// Server-side assembly of the /today social layer: everyone's bets on the slate,
// the slate's comments feed, and all reactions — shaped for the Social client
// component. Server-only (imports the service-role client).

import { db } from '@/lib/supabase';
import { REACTION_EMOJIS } from '@/lib/social';
import type {
  Bet,
  Comment,
  ExactScoreSelection,
  FootballerSelection,
  Match,
  OutcomeSelection,
  Reaction,
  Team,
} from '@/types/db';
import type {
  FeedCommentData,
  ReactionChipData,
  SlipMatchData,
  SlipRowData,
  SocialData,
} from './Social';

type MatchRow = Match & { home_team: Team; away_team: Team };

const PROP_LABEL: Record<string, string> = {
  first_scorer: 'First scorer',
  anytime_scorer: 'Anytime scorer',
  carded: 'Booked',
};

const FEED_LIMIT = 300;

// Group raw reaction rows for one target into ordered chips. Chip order follows
// the fixed palette so rows don't jiggle as counts change.
function buildChips(
  rows: Reaction[],
  viewerId: string,
  nameOf: (managerId: string) => string,
): ReactionChipData[] {
  const byEmoji = new Map<string, Reaction[]>();
  for (const r of rows) {
    const list = byEmoji.get(r.emoji);
    if (list) list.push(r);
    else byEmoji.set(r.emoji, [r]);
  }
  return [...REACTION_EMOJIS]
    .filter(e => byEmoji.has(e))
    .map(emoji => {
      const list = byEmoji.get(emoji)!;
      return {
        emoji,
        count: list.length,
        mine: list.some(r => r.manager_id === viewerId),
        names: list.map(r => nameOf(r.manager_id)),
      };
    });
}

export async function buildSocialData(opts: {
  viewerId: string;
  slateKey: string;
  members: MatchRow[];
  now: Date;
}): Promise<SocialData> {
  const { viewerId, slateKey, members, now } = opts;
  const memberIds = members.map(m => m.id);

  const [{ data: managerRows }, { data: betRows }, { data: commentRows }] = await Promise.all([
    db.from('managers').select('id, display_name, avatar_url').order('display_name'),
    db.from('bets').select('*').in('match_id', memberIds),
    db
      .from('comments')
      .select('*')
      .eq('slate_key', slateKey)
      .order('created_at', { ascending: true })
      .limit(FEED_LIMIT),
  ]);

  const managers = (managerRows ?? []) as { id: string; display_name: string; avatar_url: string | null }[];
  const allBets = (betRows ?? []) as Bet[];
  const comments = (commentRows ?? []) as Comment[];

  const nameOf = (id: string) => managers.find(m => m.id === id)?.display_name ?? 'Unknown';
  const avatarOf = (id: string) => managers.find(m => m.id === id)?.avatar_url ?? '⚽';

  // Reactions for the feed's comments.
  const commentIds = comments.map(c => c.id);
  const { data: commentReactionRows } = commentIds.length > 0
    ? await db.from('reactions').select('*').in('comment_id', commentIds)
    : { data: [] as Reaction[] };
  const commentReactions = (commentReactionRows ?? []) as Reaction[];

  // A slip on a match is revealed once the viewer can't copy it: the match is
  // locked, or the viewer's own core slip (outcome + exact score) is in.
  const betsBy = new Map<string, Bet[]>(); // `${managerId}:${matchId}`
  for (const b of allBets) {
    const key = `${b.manager_id}:${b.match_id}`;
    const list = betsBy.get(key);
    if (list) list.push(b);
    else betsBy.set(key, [b]);
  }
  const viewerHasCore = (matchId: string) => {
    const bs = betsBy.get(`${viewerId}:${matchId}`) ?? [];
    return bs.some(b => b.bet_type === 'outcome') && bs.some(b => b.bet_type === 'exact_score');
  };
  const isVisible = (m: MatchRow) =>
    m.status !== 'scheduled' || now >= new Date(m.kickoff_at) || viewerHasCore(m.id);

  const visibleMembers = members.filter(isVisible);

  // Footballer names for every visible prop pick, one batch query.
  const propIds = visibleMembers
    .flatMap(m => managers.flatMap(mgr => betsBy.get(`${mgr.id}:${m.id}`) ?? []))
    .filter(b => PROP_LABEL[b.bet_type])
    .map(b => (b.selection as FootballerSelection).footballer_id);
  const playerName = new Map<string, string>();
  if (propIds.length > 0) {
    const { data: players } = await db.from('footballers').select('id, name').in('id', propIds);
    for (const p of players ?? []) playerName.set(p.id as string, p.name as string);
  }

  const matches: SlipMatchData[] = visibleMembers.map(m => {
    const rows: SlipRowData[] = managers.map(mgr => {
      const bs = betsBy.get(`${mgr.id}:${m.id}`) ?? [];
      const outcome = bs.find(b => b.bet_type === 'outcome');
      const exact = bs.find(b => b.bet_type === 'exact_score');
      const prop = bs.find(b => PROP_LABEL[b.bet_type]);
      const ex = exact ? (exact.selection as ExactScoreSelection) : null;
      const result = outcome ? (outcome.selection as OutcomeSelection).result : null;
      return {
        managerId: mgr.id,
        name: mgr.display_name,
        avatar: mgr.avatar_url ?? '⚽',
        isYou: mgr.id === viewerId,
        score: ex ? { home: ex.home, away: ex.away } : null,
        outcome: result
          ? result === 'home'
            ? m.home_team.name
            : result === 'away'
              ? m.away_team.name
              : 'Draw'
          : null,
        mult: outcome?.stake_mult ?? 1,
        prop: prop
          ? {
              label: PROP_LABEL[prop.bet_type],
              player: playerName.get((prop.selection as FootballerSelection).footballer_id) ?? 'Unknown',
            }
          : null,
      };
    });

    return {
      id: m.id,
      home: m.home_team.name,
      away: m.away_team.name,
      homeCode: m.home_team.country_code,
      awayCode: m.away_team.country_code,
      kickoff: m.kickoff_at,
      rows,
    };
  });

  const feed: FeedCommentData[] = comments.map(c => ({
    id: c.id,
    managerId: c.manager_id,
    name: nameOf(c.manager_id),
    avatar: avatarOf(c.manager_id),
    isYou: c.manager_id === viewerId,
    body: c.body,
    gifUrl: c.gif_url,
    createdAt: c.created_at,
    reactions: buildChips(
      commentReactions.filter(r => r.comment_id === c.id),
      viewerId,
      nameOf,
    ),
  }));

  return {
    slateKey,
    matches,
    comments: feed,
    gifsEnabled: Boolean(process.env.GIPHY_API_KEY),
  };
}
