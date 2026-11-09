import { Skeleton } from "@/components/ui/skeleton";

/** Shown at once while a Scale page is prepared. */
export default function ScaleLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-10 sm:px-8" aria-busy>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-80" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
