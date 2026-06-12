# Injury & squad-withdrawal updates

football-data.org (our fixtures/squads source) carries **no injury feed**, so player
availability is a hand-maintained flag on `footballers`:

| column                    | values                       | shown as                          |
| ------------------------- | ---------------------------- | --------------------------------- |
| `availability`            | `fit` (default) / `doubtful` / `out` | nothing / `DOUBT` / `OUT` badge in the player picker |
| `availability_note`       | short free text              | warning line under a chosen player (e.g. "Ruled out — thigh injury, withdrawn from squad") |
| `availability_updated_at` | timestamptz                  | bookkeeping only                  |

`out` and suspended players sort to the bottom of the picker but stay pickable —
the news can be wrong, and a player who never appears just voids the prop.

## The update run

Do this **each morning of a match day**, before the first kickoff of the slate
(bets lock per match at kickoff, so the morning sweep covers everyone):

1. **Refresh squads** — pulls official 26-man lists and auto-marks players who
   were replaced as `out` ("Withdrawn from squad"):

   ```sh
   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/squads-sync
   ```

2. **Check the news** for teams playing in the next ~48h. Good sources:
   - ESPN's running injury tracker: <https://www.espn.com/soccer/story/_/id/48572979/2026-fifa-world-cup-injuries-tracker-which-stars-miss-latest-info>
   - Covers player status page: <https://www.covers.com/world-cup/injury-report-2026>
   - ESPN per-match preview pages ("team news" section)

3. **Set flags** in Supabase (SQL editor or Claude Code + Supabase MCP):

   ```sql
   update footballers set
     availability = 'doubtful',            -- or 'out' / 'fit'
     availability_note = 'calf, major doubt for the opener',
     availability_updated_at = now()
   where name = 'Kenan Yıldız';
   ```

   Use `out` only for *confirmed* absences (squad withdrawal, coach ruled the
   player out). Use `doubtful` for everything reported but unconfirmed. Flip back
   to `fit` (and null the note) once a player returns — squads-sync only auto-clears
   flags it set itself.

Asking Claude Code to "run the injury update" does all three steps: it researches
per-fixture team news, sets the flags, and re-runs squads-sync.

## Cadence

Daily on match days is plenty: flags exist to inform bets, and bets lock at
kickoff. Mid-tournament the squads barely change, so the squad refresh mostly
matters around the group-stage opener rush and again before the knockouts.

## Automation options (not built)

- **API-Football injuries endpoint** (paid month, ~€19+): daily cron maps their
  injury list onto `footballers` by name+team; manual flag stays as the override.
- **Scheduled Claude agent** (`/schedule`): a morning routine that does the
  news-research run and writes flags via the Supabase MCP.
