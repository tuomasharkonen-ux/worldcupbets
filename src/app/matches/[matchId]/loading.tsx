import { NavSkeleton } from '@/components/NavSkeleton';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors matches/[matchId]/page.tsx: back link, scoreboard, then the bet slip card.
export default function Loading() {
  return (
    <>
      <NavSkeleton />
      <main className="mx-auto max-w-lg space-y-6 px-4 py-8">
        <Skeleton className="h-5 w-20" />

        {/* Scoreboard */}
        <div className="space-y-4">
          <div className="flex items-center justify-end">
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-5 w-8" />
            <Skeleton className="h-6 w-full" />
          </div>
          <Skeleton className="mx-auto h-4 w-48" />
        </div>

        {/* Bet slip */}
        <Card variant="glass" padding="lg" className="space-y-5">
          <Skeleton className="h-6 w-32" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-16 rounded-xl" />
          </div>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </Card>
      </main>
    </>
  );
}
