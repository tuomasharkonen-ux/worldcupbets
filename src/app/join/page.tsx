import { joinLeague } from './actions';

const ERROR_MESSAGES: Record<string, string> = {
  missing_fields: 'Passcode and name are required.',
  wrong_passcode: 'Wrong passcode — check with the league admin.',
  league_full: 'The league is full (5 managers max).',
  server_error: 'Something went wrong. Try again.',
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMsg = error ? (ERROR_MESSAGES[error] ?? 'Something went wrong.') : null;

  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-3xl font-bold text-white tracking-tight">Gambit</h1>
          <p className="text-zinc-400 text-sm">WC 2026 — five-player betting league</p>
        </div>

        {errorMsg && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-300">
            {errorMsg}
          </div>
        )}

        <form action={joinLeague} className="space-y-4">
          <div className="space-y-1">
            <label htmlFor="passcode" className="block text-sm font-medium text-zinc-300">
              League passcode
            </label>
            <input
              id="passcode"
              name="passcode"
              type="password"
              required
              autoComplete="off"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Enter the shared passcode"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="display_name" className="block text-sm font-medium text-zinc-300">
              Your name
            </label>
            <input
              id="display_name"
              name="display_name"
              type="text"
              required
              maxLength={32}
              autoComplete="nickname"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="How you'll appear on the leaderboard"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
          >
            Join the league
          </button>
        </form>
      </div>
    </main>
  );
}
