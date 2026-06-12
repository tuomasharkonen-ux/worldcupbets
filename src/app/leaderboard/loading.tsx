import { NavSkeleton } from '@/components/NavSkeleton';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors leaderboard/page.tsx: header, then a glass card of ranked manager rows.
export default function Loading() {
  return (
    <>
      <NavSkeleton />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center gap-2.5">
          <Skeleton className="size-7 rounded-lg" />
          <Skeleton className="h-7 w-40" />
        </div>

        <Card variant="glass" padding="sm">
          <ul className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <li key={i} className="flex items-center gap-2.5 rounded-xl bg-surface-2/60 px-2.5 py-2.5">
                <Skeleton className="size-6 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-3 w-10" />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </>
  );
}
