export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  ClipboardListIcon,
  FileCheck2Icon,
  TrophyIcon,
} from "lucide-react";

import { requireRole } from "@/server/auth/session";
import { listStudentAttempts } from "@/server/services/attempts";
import { StudentExamsList } from "@/components/features/student/student-exams-list";
import { serializeDoc, timestampToDate } from "@/lib/serialize";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const metadata = { title: "My Exams • Bridge" };

/**
 * Exams hub: the header + summary stats render on the server (zero JS, paints
 * immediately), while search / filter / pagination live in the small client
 * island below. Listing excludes answers server-side, so even 100 attempts
 * stay a light payload.
 */
export default async function StudentExamsPage() {
  const actor = await requireRole("student");
  let items: Awaited<ReturnType<typeof listStudentAttempts>> = [];
  let loadFailed = false;
  try {
    items = await listStudentAttempts(actor);
  } catch (err) {
    console.error("[student/exams] load failed", err);
    loadFailed = true;
  }

  if (loadFailed) {
    return (
      <div className="relative mx-auto flex w-full max-w-6xl flex-col">
        <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-72">
          <div className="bg-mesh absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        </div>
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-destructive/30 bg-destructive/[0.06] px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangleIcon className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Exams couldn&apos;t load</h1>
            <p className="mx-auto mt-1.5 max-w-md text-sm text-muted-foreground">
              Check your connection and try again — if this keeps happening, contact your
              administrator.
            </p>
          </div>
          <Button nativeButton={false} render={<Link href="/student/exams" />}>
            Retry
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    );
  }

  const upcoming = items.filter(
    (i) => i.attempt.status === "pending" || i.attempt.status === "in_progress",
  );
  const completed = items.filter(
    (i) => i.attempt.status !== "pending" && i.attempt.status !== "in_progress",
  );
  const scored = completed.filter((i) => i.attempt.score != null);
  const avg =
    scored.length > 0
      ? Math.round(
          scored.reduce((n, i) => n + (i.attempt.score?.percentage ?? 0), 0) / scored.length,
        )
      : null;
  const awaitingGrades = items.filter((i) => i.attempt.status === "submitted").length;
  const nextDue = upcoming
    .map((i) => timestampToDate(i.attempt.scheduledFor))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 sm:gap-8">
      {/* Ambient page glow — pure CSS, zero JS, paints once behind the header. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-72">
        <div className="bg-mesh absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
      </div>

      {/* ── Server-rendered header: stats paint with the HTML, no JS ── */}
      <div>
        <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">
          Exams
          {nextDue
            ? ` · next due ${nextDue.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Kampala" })}`
            : ""}
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              My exams
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground sm:text-[15px]">
              {upcoming.length === 0
                ? "All caught up — nothing waiting right now."
                : `${upcoming.length} to take — start with your next exam below.`}
              {awaitingGrades > 0 &&
                ` ${awaitingGrades} await${awaitingGrades === 1 ? "s" : ""} grading.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-card">
              <ClipboardListIcon className="size-3.5 text-amber-600 dark:text-amber-400" />
              {upcoming.length} to take
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-card">
              <FileCheck2Icon className="size-3.5 text-emerald-600 dark:text-emerald-400" />
              {completed.length} completed
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-card",
                avg !== null && avg >= 80 && "text-emerald-600 dark:text-emerald-400",
                avg !== null && avg < 80 && avg >= 50 && "text-amber-600 dark:text-amber-400",
                avg !== null && avg < 50 && "text-rose-600 dark:text-rose-400",
              )}
            >
              <TrophyIcon className="size-3.5" />
              {avg !== null ? `${avg}% avg` : "No average yet"}
            </span>
          </div>
        </div>
      </div>

      <StudentExamsList
        items={items.map((i) => ({
          attempt: serializeDoc(i.attempt),
          exam: i.exam,
        }))}
      />
    </div>
  );
}
