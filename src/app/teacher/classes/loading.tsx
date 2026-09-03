export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading classes">
      {/* Hero skeleton mirrors the loaded hero to avoid layout shift. */}
      <div className="rounded-2xl border p-6 sm:p-7">
        <div className="bg-muted h-6 w-44 animate-pulse rounded-full" />
        <div className="bg-muted mt-3 h-8 w-64 max-w-full animate-pulse rounded-lg" />
        <div className="bg-muted mt-2 h-4 w-96 max-w-full animate-pulse rounded-md" />
        <div className="mt-4 flex flex-wrap gap-2.5">
          <div className="bg-muted h-9 w-32 animate-pulse rounded-xl" />
          <div className="bg-muted h-9 w-32 animate-pulse rounded-xl" />
          <div className="bg-muted hidden h-9 w-40 animate-pulse rounded-xl sm:block" />
        </div>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <li
            key={i}
            className="bg-card overflow-hidden rounded-xl ring-1 ring-foreground/10"
          >
            <div className="bg-muted h-1 w-full animate-pulse" />
            <div className="flex gap-3 p-5">
              <div className="bg-muted size-10 shrink-0 animate-pulse rounded-xl" />
              <div className="flex-1">
                <div className="bg-muted h-5 w-3/4 animate-pulse rounded-md" />
                <div className="bg-muted mt-2 h-4 w-1/3 animate-pulse rounded-md" />
              </div>
            </div>
            <div className="flex gap-2 px-5 pb-5">
              <div className="bg-muted h-8 flex-1 animate-pulse rounded-md" />
              <div className="bg-muted h-8 flex-1 animate-pulse rounded-md" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
