"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

type PaginationProps =
  | { page: number; totalPages: number; className?: string }
  | {
      cursor: string | null;
      previousCursor: string | null;
      nextCursor: string | null;
      className?: string;
    };

/** Numbered directory pagination or opaque-cursor previous/next navigation. */
export function Pagination(props: PaginationProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { className } = props;

  const btn = (active: boolean, disabled = false) =>
    cn(
      "flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm font-medium tabular-nums transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      disabled && "pointer-events-none opacity-40",
    );

  if ("cursor" in props) {
    if (!props.cursor && !props.nextCursor) return null;

    const hrefForCursor = (cursor: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      if (cursor) params.set("cursor", cursor);
      else params.delete("cursor");
      const query = params.toString();
      return query ? `${pathname}?${query}` : pathname;
    };

    return (
      <nav
        aria-label="Pagination"
        className={cn("flex items-center justify-center gap-1.5", className)}
      >
        <Link
          href={hrefForCursor(props.previousCursor)}
          className={btn(false, !props.cursor)}
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="size-4" />
          Previous
        </Link>
        <Link
          href={hrefForCursor(props.nextCursor)}
          className={btn(false, !props.nextCursor)}
          aria-label="Next page"
        >
          Next
          <ChevronRightIcon className="size-4" />
        </Link>
      </nav>
    );
  }

  const { page, totalPages } = props;
  if (totalPages <= 1) return null;

  const hrefFor = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    return `${pathname}?${params.toString()}`;
  };

  const window = pageWindow(page, totalPages, 1);

  return (
    <nav aria-label="Pagination" className={cn("flex items-center justify-center gap-1.5", className)}>
      <Link href={hrefFor(Math.max(1, page - 1))} className={btn(false, page <= 1)} aria-label="Previous page">
        <ChevronLeftIcon className="size-4" />
      </Link>
      {window.map((p, i) =>
        p === "…" ? (
          <span key={`gap-${i}`} className="text-muted-foreground px-1 text-sm">
            …
          </span>
        ) : (
          <Link key={p} href={hrefFor(p)} className={btn(p === page)} aria-current={p === page ? "page" : undefined}>
            {p}
          </Link>
        ),
      )}
      <Link
        href={hrefFor(Math.min(totalPages, page + 1))}
        className={btn(false, page >= totalPages)}
        aria-label="Next page"
      >
        <ChevronRightIcon className="size-4" />
      </Link>
    </nav>
  );
}
