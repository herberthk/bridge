"use client";

import { useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRightIcon,
  BookOpenCheckIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  ClockIcon,
  FileCheck2Icon,
  FlameIcon,
  HelpCircleIcon,
  HistoryIcon,
  LayersIcon,
  TimerIcon,
  TrophyIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SUBJECT_LABELS, type Subject } from "@/lib/constants";
import type { StudentAttemptListItem } from "@/server/services/attempts";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AttemptWithExam {
  /** Projected attempt (list fields only — answers are not sent to clients). */
  attempt: SerializedWithId<StudentAttemptListItem>;
  exam: {
    id: string;
    title: string;
    subject: string;
    durationMinutes: number;
    questionCount: number;
  } | null;
}

// ─── Status configuration ─────────────────────────────────────────────────────

type StatusKey = "pending" | "in_progress" | "submitted" | "graded" | "flagged";

const STATUS_META: Record<
  StatusKey,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    color: string;
    dot: string;
  }
> = {
  pending: {
    label: "Ready",
    variant: "default",
    color: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  in_progress: {
    label: "In Progress",
    variant: "secondary",
    color: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500 animate-pulse",
  },
  submitted: {
    label: "Grading…",
    variant: "outline",
    color: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500 animate-pulse",
  },
  graded: {
    label: "Graded",
    variant: "secondary",
    color: "text-violet-600 dark:text-violet-400",
    dot: "bg-violet-500",
  },
  flagged: {
    label: "Under Review",
    variant: "destructive",
    color: "text-rose-600 dark:text-rose-400",
    dot: "bg-rose-500",
  },
};

function getStatusMeta(status: string) {
  return STATUS_META[status as StatusKey] ?? {
    label: status,
    variant: "outline" as const,
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
  };
}

function getScoreColor(pct: number) {
  if (pct >= 80) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 60) return "text-amber-600 dark:text-amber-400";
  return "text-rose-600 dark:text-rose-400";
}

function getProgressColor(pct: number) {
  if (pct >= 80) return "[&>*]:bg-emerald-500";
  if (pct >= 60) return "[&>*]:bg-amber-500";
  return "[&>*]:bg-rose-500";
}

// ─── Pagination constant ──────────────────────────────────────────────────────

const PAGE_SIZE = 10;

// ─── Upcoming exam card ───────────────────────────────────────────────────────

function UpcomingCard({ attempt, exam }: AttemptWithExam) {
  const meta = getStatusMeta(attempt.status);
  const isRetake = !!(attempt as unknown as { retakeOf?: string | null }).retakeOf;
  const isPending = attempt.status === "pending";

  return (
    <div className="group relative flex flex-col rounded-2xl border bg-card p-5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md overflow-hidden">
      {/* Decorative top accent bar */}
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-[3px] rounded-t-2xl",
          isPending
            ? "bg-gradient-to-r from-emerald-500 to-teal-400"
            : "bg-gradient-to-r from-amber-500 to-orange-400",
        )}
      />

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl",
              isPending
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {isPending ? (
              <BookOpenCheckIcon className="size-5" />
            ) : (
              <FlameIcon className="size-5" />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate font-semibold leading-snug">{exam?.title ?? "Exam"}</p>
            <p className="text-muted-foreground mt-0.5 truncate text-xs">
              {exam ? (SUBJECT_LABELS[exam.subject as Subject] ?? exam.subject) : ""}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {isRetake && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
            >
              Retake
            </Badge>
          )}
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            <span className={cn("text-xs font-medium", meta.color)}>{meta.label}</span>
          </div>
        </div>
      </div>

      {/* Meta row */}
      <div className="text-muted-foreground mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <TimerIcon className="size-3.5 shrink-0" />
          <span>{exam?.durationMinutes ?? "–"} min</span>
        </span>
        <span className="flex items-center gap-1.5">
          <HelpCircleIcon className="size-3.5 shrink-0" />
          <span>{exam?.questionCount ?? "–"} questions</span>
        </span>
        {attempt.scheduledFor && (
          <span className="flex items-center gap-1.5">
            <ClockIcon className="size-3.5 shrink-0" />
            <span>{format(parseDate(attempt.scheduledFor)!, "d MMM, HH:mm")}</span>
          </span>
        )}
      </div>

      {/* CTA */}
      <div className="mt-5">
        {isPending ? (
          <Button
            className="shadow-glow w-full"
            nativeButton={false}
            render={<Link href={`/exam/${attempt.id}`} />}
          >
            Start Exam
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            nativeButton={false}
            render={<Link href={`/exam/${attempt.id}`} />}
          >
            Continue Exam
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Completed exam row ───────────────────────────────────────────────────────

function CompletedRow({ attempt, exam }: AttemptWithExam) {
  const meta = getStatusMeta(attempt.status);
  const isRetake = !!(attempt as unknown as { retakeOf?: string | null }).retakeOf;
  const score = attempt.score;

  return (
    <div className="group relative flex items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/40">
      {/* Accessible overlay link */}
      <Link
        href={`/student/results/${attempt.id}`}
        aria-label={`View results for ${exam?.title ?? "exam"}`}
        className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />

      {/* Icon */}
      <div className="pointer-events-none relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-muted-foreground">
        <FileCheck2Icon className="size-4" />
      </div>

      {/* Title + date */}
      <div className="pointer-events-none relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-medium">{exam?.title ?? "Exam"}</p>
          {isRetake && (
            <Badge
              variant="outline"
              className="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-400"
            >
              Retake
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {attempt.submittedAt
            ? format(parseDate(attempt.submittedAt)!, "d MMM yyyy · HH:mm")
            : "—"}
        </p>
      </div>

      {/* History link — hover-reveal on desktop */}
      {exam && (
        <Link
          href={`/student/exams/${exam.id}`}
          className="relative z-10 hidden shrink-0 items-center gap-1 text-[11px] text-primary opacity-0 transition-opacity group-hover:opacity-100 hover:underline sm:flex"
        >
          <HistoryIcon className="size-3" />
          History
        </Link>
      )}

      {/* Score / status */}
      <div className="pointer-events-none relative shrink-0">
        {score ? (
          <div className="flex w-28 flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Score</span>
              <span className={cn("font-bold tabular-nums", getScoreColor(score.percentage))}>
                {score.percentage}%
              </span>
            </div>
            <Progress
              value={score.percentage}
              className={cn("h-1.5 bg-muted", getProgressColor(score.percentage))}
            />
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className={cn("size-1.5 rounded-full", meta.dot)} />
            <span className={cn("text-xs font-medium", meta.color)}>{meta.label}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pagination controls ──────────────────────────────────────────────────────

interface PaginationProps {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}

function Pagination({ page, totalPages, onPage }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | "…")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 3) pages.push("…");
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i);
    }
    if (page < totalPages - 2) pages.push("…");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-between border-t px-5 py-3">
      <p className="text-muted-foreground text-xs">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPage(page - 1)}
          disabled={page === 1}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeftIcon className="size-4" />
        </button>

        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-8 items-center justify-center text-muted-foreground text-xs"
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => onPage(p)}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-sm font-medium transition-colors",
                p === page
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "hover:bg-accent",
              )}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          ),
        )}

        <button
          onClick={() => onPage(page + 1)}
          disabled={page === totalPages}
          className="flex size-8 items-center justify-center rounded-lg text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRightIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StudentExamsList({ items }: { items: AttemptWithExam[] }) {
  const [page, setPage] = useState(1);

  const upcoming = items.filter(
    (i) => i.attempt.status === "pending" || i.attempt.status === "in_progress",
  );
  const past = items.filter(
    (i) => i.attempt.status !== "pending" && i.attempt.status !== "in_progress",
  );

  const totalPages = Math.max(1, Math.ceil(past.length / PAGE_SIZE));
  const pagedPast = past.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const gradedItems = past.filter((i) => i.attempt.score);
  const avgScore =
    gradedItems.length > 0
      ? Math.round(
          gradedItems.reduce((sum, i) => sum + (i.attempt.score?.percentage ?? 0), 0) /
            gradedItems.length,
        )
      : null;

  function handlePageChange(p: number) {
    setPage(p);
    document
      .getElementById("completed-section")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-8">
      {/* ── Page header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">My Exams</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {upcoming.length} to take · {past.length} completed
            {avgScore !== null && ` · avg score ${avgScore}%`}
          </p>
        </div>

        {past.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm">
              <LayersIcon className="size-3.5 text-muted-foreground" />
              <span>{past.length} attempted</span>
            </div>
            {avgScore !== null && (
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium shadow-sm",
                  getScoreColor(avgScore),
                )}
              >
                <TrophyIcon className="size-3.5" />
                <span>{avgScore}% avg</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Upcoming / active exams ── */}
      <section aria-labelledby="upcoming-heading">
        <h2
          id="upcoming-heading"
          className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Upcoming &amp; Active
        </h2>

        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/50 p-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <ClipboardListIcon className="size-6" />
            </div>
            <div>
              <p className="font-medium">No exams waiting</p>
              <p className="text-muted-foreground mt-1 max-w-sm text-sm text-pretty">
                When your teacher assigns an exam, it will appear here with its schedule and
                duration.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map(({ attempt, exam }) => (
              <UpcomingCard key={attempt.id} attempt={attempt} exam={exam} />
            ))}
          </div>
        )}
      </section>

      {/* ── Completed exams ── */}
      {past.length > 0 && (
        <section id="completed-section" aria-labelledby="completed-heading">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="completed-heading"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Completed
            </h2>
            {past.length > PAGE_SIZE && (
              <p className="text-muted-foreground text-xs">
                Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, past.length)} of{" "}
                {past.length}
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="divide-y">
              {pagedPast.map(({ attempt, exam }) => (
                <CompletedRow key={attempt.id} attempt={attempt} exam={exam} />
              ))}
            </div>
            <Pagination page={page} totalPages={totalPages} onPage={handlePageChange} />
          </div>
        </section>
      )}

      {/* ── Empty state (no exams at all) ── */}
      {past.length === 0 && upcoming.length === 0 && (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed bg-card/50 p-16 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <CheckCircle2Icon className="size-8" />
          </div>
          <div>
            <p className="font-semibold">Nothing here yet</p>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm text-pretty">
              Your exam history will appear here once you&apos;ve been assigned and completed your
              first exam.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
