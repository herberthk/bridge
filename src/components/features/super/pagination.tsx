"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { pageWindow } from "@/lib/pagination";
import { cn } from "@/lib/utils";

/**
 * Numbered, cursor-free pagination for the platform directories. Page numbers
 * travel as `?page=N` query params so every page is a shareable URL; all other
 * query params (search/filters) are preserved.
 */
export function Pagination({
  page,
  totalPages,
  className,
}: {
  page: number;
  totalPages: number;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  if (totalPages <= 1) return null;

  const hrefFor = (p: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    return `${pathname}?${params.toString()}`;
  };

  const window = pageWindow(page, totalPages, 1);
  const btn = (active: boolean, disabled = false) =>
    cn(
      "flex h-8 min-w-8 items-center justify-center rounded-lg border px-2 text-sm font-medium tabular-nums transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      disabled && "pointer-events-none opacity-40",
    );

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
