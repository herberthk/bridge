import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

/**
 * Shared premium page header for admin surfaces.
 *
 * Server-component safe (no hooks, no motion) so it can render in `page.tsx`
 * for static titles and inside client views alike. Keeps eyebrow, title,
 * description and actions visually consistent across dashboard, teachers,
 * school, exams, requests, voice and wallet.
 */
export function AdminPageHeader({
  icon,
  eyebrow,
  title,
  description,
  actions,
  meta,
  className,
}: {
  icon?: ReactNode;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "shadow-card relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-7",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className="from-primary/[0.06] via-primary/0 to-transparent pointer-events-none absolute inset-0 bg-linear-to-r"
      />
      <div className="relative flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-start gap-3.5">
          {icon ? (
            <span className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow || meta ? (
              <div className="flex flex-wrap items-center gap-2">
                {eyebrow ? (
                  <Badge variant="secondary" className="gap-1.5 font-normal">
                    <span className="inline-block size-2 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                    {eyebrow}
                  </Badge>
                ) : null}
                {meta ? (
                  <span className="text-muted-foreground text-xs">{meta}</span>
                ) : null}
              </div>
            ) : null}
            <h1 className="mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="text-muted-foreground mt-1 max-w-2xl text-xs text-pretty sm:text-sm">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {actions ? (
          <div className="flex flex-wrap items-center gap-2.5 md:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
