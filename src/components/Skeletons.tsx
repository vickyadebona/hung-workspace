import { Skeleton } from '@/components/ui/skeleton';
import { pageShell } from './PageEditor';

/** Grey placeholder shapes shown while a page loads, shaped like the page that is about to appear. */
export function PageSkeleton() {
  const lines = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/5'];
  return (
    <div className={pageShell} role="status" aria-label="Loading page">
      <div className="mb-8 flex items-center gap-3 md:pl-[54px]">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-9 w-2/3" />
      </div>
      <div className="flex flex-col gap-3 md:pl-[54px]">
        <Skeleton className="h-5 w-1/3" />
        {lines.map((w, i) => (
          <Skeleton key={i} className={`h-4 ${w}`} />
        ))}
        <Skeleton className="mt-4 h-5 w-1/4" />
        {lines.slice(0, 3).map((w, i) => (
          <Skeleton key={`b${i}`} className={`h-4 ${w}`} />
        ))}
      </div>
    </div>
  );
}

/** The same idea for a database: a title, a row of view tabs, and a few table rows. */
export function DatabaseSkeleton() {
  return (
    <div className="mx-auto max-w-[1200px] px-3.5 pt-6 pb-28 md:px-10 md:pt-8" role="status" aria-label="Loading database">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-10 rounded-lg" />
        <Skeleton className="h-9 w-64" />
      </div>
      <div className="mb-3 flex items-center justify-between border-b pb-2">
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
          <Skeleton className="h-7 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-7 w-14" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-6 w-20 rounded-full" />
            <Skeleton className="h-6 w-24 rounded-full" />
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Placeholder rows for the sidebar page list before the first load finishes. */
export function SidebarSkeleton() {
  const widths = ['w-3/4', 'w-2/3', 'w-4/5', 'w-1/2', 'w-3/5'];
  return (
    <div className="flex flex-col gap-2 px-2 py-1" role="status" aria-label="Loading pages">
      {widths.map((w, i) => (
        <div key={i} className="flex items-center gap-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className={`h-4 ${w}`} />
        </div>
      ))}
    </div>
  );
}
