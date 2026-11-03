import { Skeleton } from "./skeleton";
import { PageContainer } from "./page-header";

/**
 * Shown the instant a link is clicked, while the next page is prepared on the server (loading.tsx):
 * the navigation feels immediate instead of waiting on a frozen screen.
 */
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <PageContainer aria-busy className="max-w-5xl">
      <div className="space-y-2 pb-8">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </PageContainer>
  );
}

/** A conversation being opened: a few message shapes and the message box. */
export function ChatSkeleton() {
  return (
    <div aria-busy className="flex h-full min-h-0 flex-col">
      <div className="flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-10 sm:px-6">
          <div className="flex justify-end">
            <Skeleton className="h-11 w-2/3 rounded-2xl" />
          </div>
          <div className="space-y-2.5">
            <div className="flex items-center gap-2.5">
              <Skeleton className="size-[30px] rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </div>
      </div>
      <div className="shrink-0 px-4 pb-4 sm:px-6">
        <Skeleton className="mx-auto h-[104px] w-full max-w-3xl rounded-2xl" />
      </div>
    </div>
  );
}
