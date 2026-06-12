import { NavSkeleton } from '@/components/NavSkeleton';
import { Skeleton } from '@/components/ui/skeleton';

// Mirrors the Today "Shell" + betting layout (see today/page.tsx): slate header,
// a centered hero, then a short stack of match rows.
export default function Loading() {
  return (
    <>
      <NavSkeleton />
      <main className="mx-auto max-w-lg space-y-5 px-4 py-8">
        {/* SlateHeader */}
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-6 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-36" />
          </div>
        </div>

        {/* Hero: icon, title, subtitle, countdown */}
        <div className="flex flex-col items-center gap-3 py-3">
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-12 w-48 rounded-2xl" />
        </div>

        {/* Match rows */}
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-3 px-1 py-3.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-4 w-6" />
                <Skeleton className="h-5 w-full" />
              </div>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
