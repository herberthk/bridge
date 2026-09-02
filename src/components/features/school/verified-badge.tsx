import { BadgeCheckIcon } from "lucide-react";

import type { SchoolVerificationStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * The school "blue tick". Only rendered as verified for schools a super admin
 * has verified — the two other states get their own subdued styling.
 */
export function VerifiedBadge({
  status,
  size = "sm",
  className,
}: {
  status: SchoolVerificationStatus | undefined | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (status === "verified") {
    return (
      <span
        title="Verified school"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 font-semibold text-sky-600 dark:text-sky-400",
          size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
          className,
        )}
      >
        <BadgeCheckIcon
          className={cn("fill-sky-500 text-white dark:text-sky-950", size === "sm" ? "size-3.5" : "size-4")}
        />
        Verified
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span
        title="Verification pending review"
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 font-medium text-amber-600 dark:text-amber-400",
          size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
          className,
        )}
      >
        <BadgeCheckIcon className={size === "sm" ? "size-3.5" : "size-4"} />
        Pending
      </span>
    );
  }
  return null;
}
