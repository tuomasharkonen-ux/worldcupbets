import { getSession } from '@/lib/session';

// GIF search proxy for the match-day comments feed. Keeps the Giphy key
// server-side; the picker calls this with ?q= (empty → trending). When no
// GIPHY_API_KEY is configured the feature reports itself disabled and the
// composer hides its GIF button.

type GiphyImage = { url?: string; width?: string; height?: string };
type GiphyGif = {
  id: string;
  title?: string;
  images?: { fixed_height?: GiphyImage; fixed_height_small?: GiphyImage; original?: GiphyImage };
};

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.managerId) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const key = process.env.GIPHY_API_KEY;
  if (!key) return Response.json({ enabled: false, gifs: [] });

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const endpoint = q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
  const params = new URLSearchParams({ api_key: key, limit: '24', rating: 'pg-13' });
  if (q) params.set('q', q);

  const res = await fetch(`${endpoint}?${params}`, { cache: 'no-store' });
  if (!res.ok) return Response.json({ enabled: true, gifs: [] });

  const json = (await res.json()) as { data?: GiphyGif[] };
  const gifs = (json.data ?? [])
    .map(g => ({
      id: g.id,
      // fixed_height (200px tall) is what gets stored on the comment and rendered.
      url: g.images?.fixed_height?.url ?? g.images?.original?.url ?? '',
      preview: g.images?.fixed_height_small?.url ?? g.images?.fixed_height?.url ?? '',
      alt: g.title || 'GIF',
    }))
    .filter(g => g.url !== '');

  return Response.json({ enabled: true, gifs });
}
