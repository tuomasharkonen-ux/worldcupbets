import { NavSkeleton } from '@/components/NavSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors fixtures/page.tsx: header, then match-day sections each with a few rows.
export default function Loading() {
  return (
    <>
      <NavSkeleton />
      <main className="mx-auto max-w-2xl space-y-8 px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-6 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-44" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
        </div>

        {/* Match-day groups */}
        {Array.from({ length: 2 }).map((_, g) => (
          <section key={g} className="space-y-3">
            <div className="flex items-baseline justify-between border-b border-border pb-1.5">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="space-y-2.5">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-3 px-1 py-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <Skeleton className="h-5 w-full" />
                    <Skeleton className="h-4 w-6" />
                    <Skeleton className="h-5 w-full" />
                  </div>
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </main>
    </>
  );
}
