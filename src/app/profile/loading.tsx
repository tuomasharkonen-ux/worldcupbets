import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors profile/page.tsx: no top nav — a back link, a title, then stacked cards.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-xl space-y-6 px-4 py-8">
      <Skeleton className="h-8 w-20 rounded-xl" />
      <Skeleton className="h-9 w-48" />

      {/* Identity + standings */}
      <Card variant="glass" padding="lg" className="space-y-5">
        <div className="flex items-center gap-4">
          <Skeleton className="size-16 rounded-3xl" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 rounded-2xl" />
          <Skeleton className="h-20 rounded-2xl" />
        </div>
      </Card>

      {/* Two form cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <Card key={i} variant="glass" padding="lg" className="space-y-5">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
        </Card>
      ))}
    </main>
  );
}
