import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Static numeral tile — zero JS by design. Shared by student dashboards. */
export function KpiTile({
  icon: Icon,
  label,
  value,
  hint,
  accent,
  iconClass,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  iconClass?: string;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl p-5",
        accent
          ? "bg-brand bg-noise text-white shadow-glow ring-1 ring-white/20"
          : "border bg-card shadow-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-lg",
            accent ? "bg-white/15 text-white" : iconClass,
          )}
        >
          <Icon className="size-4" />
        </span>
        <p className={cn("text-[13px] font-medium", accent ? "opacity-80" : "text-muted-foreground")}>
          {label}
        </p>
      </div>
      <p className="mt-2.5 truncate text-3xl font-bold tabular-nums">{value}</p>
      {hint && (
        <p className={cn("mt-1 truncate text-xs", accent ? "opacity-70" : "text-muted-foreground")}>
          {hint}
        </p>
      )}
    </div>
  );
}
