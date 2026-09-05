"use client";

import { memo, useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ClockIcon,
  HistoryIcon,
  InboxIcon,
  MessageSquareQuoteIcon,
  RotateCcwIcon,
  SearchIcon,
  UserIcon,
  XIcon,
} from "lucide-react";

import { decideRetakeAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { RetakeDecisionEntry } from "@/server/services/retakes";
import type { RetakeRequestDoc } from "@/types/firestore";
import type { Serialized, SerializedWithId } from "@/lib/serialize";
import { parseDate } from "@/lib/serialize";
import { getAvatarColor, getInitials } from "@/lib/admin-ui";
import { AdminPageHeader } from "@/components/features/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDisplay,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";

// ─── Types ──────────────────────────────────────────────────────────────────────

type SortField = "createdAt" | "student" | "exam";
type SortDir = "asc" | "desc";

const SORT_FIELD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "createdAt", label: "Sort by date" },
  { value: "student", label: "Sort by student" },
  { value: "exam", label: "Sort by exam" },
];

// ─── Helpers (shared, unit-tested in lib/admin-ui) ────────────────────────────

// ─── Request Card (memoized — approve/reject re-renders stay local) ──────────

const RequestCard = memo(function RequestCard({
  request,
  studentName,
  examTitle,
  onDecide,
  pending,
}: {
  request: SerializedWithId<RetakeRequestDoc>;
  studentName: string;
  examTitle: string;
  onDecide: (id: string, approve: boolean) => void;
  pending: boolean;
}) {
  const color = getAvatarColor(request.studentId);
  const createdAt = request.createdAt ? parseDate(request.createdAt) : null;

  return (
    <div className="shadow-card group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-shadow hover:shadow-md sm:flex-row sm:items-start sm:gap-5">
      {/* Avatar */}
      <span
        className={`inline-flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${color}`}
      >
        {getInitials(studentName)}
      </span>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-2">
        {/* Student + exam */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <UserIcon className="size-3.5 text-muted-foreground" />
            {studentName}
          </div>
          <span className="text-muted-foreground/40">·</span>
          <div className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <BookOpenIcon className="size-3 shrink-0" />
            <span className="max-w-50 truncate">{examTitle}</span>
          </div>
          {createdAt && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <ClockIcon className="size-3 shrink-0" />
                {format(createdAt, "d MMM yyyy, HH:mm")}
              </div>
            </>
          )}
        </div>

        {/* Reason */}
        <div className="flex items-start gap-2 rounded-lg border-l-2 border-primary/30 bg-muted/40 px-3 py-2">
          <MessageSquareQuoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <p className="line-clamp-3 text-sm text-pretty italic text-muted-foreground">
            {request.reason}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 gap-2 self-end sm:self-center">
        <Button
          size="sm"
          className="shadow-glow"
          disabled={pending}
          onClick={() => onDecide(request.id, true)}
        >
          <CheckIcon data-icon="inline-start" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => onDecide(request.id, false)}
        >
          <XIcon data-icon="inline-start" />
          Reject
        </Button>
      </div>
    </div>
  );
});

// ─── Main Export ─────────────────────────────────────────────────────────────────

export function RetakeRequests({
  requests,
  studentNames,
  examTitles,
  history = [],
  deciderNames = {},
  historyExamTitles = {},
  viewerUid,
}: {
  requests: SerializedWithId<RetakeRequestDoc>[];
  studentNames: Record<string, string>;
  examTitles: Record<string, string>;
  /** Decided requests + direct grants — who decided what, and when. */
  history?: Serialized<RetakeDecisionEntry>[];
  deciderNames?: Record<string, string>;
  historyExamTitles?: Record<string, string>;
  /** Marks the viewer's own decisions with "(you)" in the history. */
  viewerUid?: string;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    decideRetakeAction,
    null,
  );
  const [, startTransition] = useTransition();
  const lastApproveRef = useRef<boolean | null>(null);

  // ── Filter + sort state ───────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(lastApproveRef.current ? "Retake approved" : "Retake rejected");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  const submit = useCallback(
    (requestId: string, approve: boolean) => {
      const fd = new FormData();
      fd.set("requestId", requestId);
      fd.set("approve", String(approve));
      lastApproveRef.current = approve;
      startTransition(() => {
        formAction(fd);
      });
    },
    [formAction],
  );

  // ── Derived: filtered + sorted ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return requests;
    return requests.filter((r) => {
      const name = (studentNames[r.studentId] ?? "").toLowerCase();
      const exam = (examTitles[r.examId] ?? "").toLowerCase();
      return name.includes(q) || exam.includes(q) || r.reason.toLowerCase().includes(q);
    });
  }, [requests, query, studentNames, examTitles]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "student":
          cmp = (studentNames[a.studentId] ?? "").localeCompare(studentNames[b.studentId] ?? "");
          break;
        case "exam":
          cmp = (examTitles[a.examId] ?? "").localeCompare(examTitles[b.examId] ?? "");
          break;
        case "createdAt": {
          const at = a.createdAt ? (parseDate(a.createdAt)?.getTime() ?? 0) : 0;
          const bt = b.createdAt ? (parseDate(b.createdAt)?.getTime() ?? 0) : 0;
          cmp = at - bt;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir, studentNames, examTitles]);

  const hasFilters = !!query;

  return (
    <div className="flex flex-col gap-6">

      {/* ── Page Header ──────────────────────────────────────────────────────────── */}
      <AdminPageHeader
        icon={<RotateCcwIcon className="size-5" />}
        eyebrow="Student appeals"
        title="Retake Requests"
        description="Approving creates a fresh attempt for the student. Rejected requests are recorded in history for transparency."
        actions={
          requests.length > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
              <ClockIcon className="size-4 shrink-0" />
              <span className="text-lg font-bold tabular-nums leading-none">{requests.length}</span>
              <span className="text-xs font-medium opacity-80">
                {requests.length === 1 ? "pending request" : "pending requests"}
              </span>
            </div>
          ) : undefined
        }
      />

      {/* ── Toolbar ───────────────────────────────────────────────────────────────── */}
      {requests.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by student, exam, or reason…"
              className="pl-9 pr-9"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>

          {/* Sort */}
          <Select value={sortField} onValueChange={(v) => { setSortField(v as SortField); setSortDir("desc"); }}>
            <SelectTrigger className="w-42.5">
              <SelectDisplay
                value={sortField}
                options={SORT_FIELD_OPTIONS}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">Sort by date</SelectItem>
              <SelectItem value="student">Sort by student</SelectItem>
              <SelectItem value="exam">Sort by exam</SelectItem>
            </SelectContent>
          </Select>

          {/* Direction toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            aria-label={sortDir === "asc" ? "Sort descending" : "Sort ascending"}
            className="shrink-0"
          >
            {sortDir === "asc" ? (
              <ChevronUpIcon className="size-4" />
            ) : (
              <ChevronDownIcon className="size-4" />
            )}
            {sortDir === "asc" ? "Oldest first" : "Newest first"}
          </Button>
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────────────── */}
      {requests.length === 0 ? (
        /* Zero requests */
        <div className="shadow-card flex flex-col items-center gap-4 rounded-xl border bg-card p-16 text-center">
          <span className="bg-brand-soft flex size-14 items-center justify-center rounded-2xl text-primary">
            <InboxIcon className="size-7" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-semibold">No pending requests</p>
            <p className="text-muted-foreground max-w-xs text-sm text-pretty">
              Students&apos; retake requests will appear here for approval.
            </p>
          </div>
        </div>
      ) : sorted.length === 0 ? (
        /* Search returned nothing */
        <div className="shadow-card flex flex-col items-center gap-4 rounded-xl border bg-card p-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <SearchIcon className="size-7" />
          </span>
          <div className="flex flex-col gap-1">
            <p className="font-semibold">No matching requests</p>
            <p className="text-muted-foreground text-sm">
              Try adjusting your search.
            </p>
          </div>
          {hasFilters && (
            <Button variant="outline" size="sm" onClick={() => setQuery("")}>
              <XIcon data-icon="inline-start" />
              Clear search
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Result summary */}
          {hasFilters && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {sorted.length} of {requests.length} requests match
            </p>
          )}

          {sorted.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              studentName={studentNames[r.studentId] ?? "Unknown student"}
              examTitle={examTitles[r.examId] ?? "Unknown exam"}
              onDecide={submit}
              pending={pending}
            />
          ))}
        </div>
      )}

      <RetakeHistoryCard
        history={history}
        studentNames={studentNames}
        examTitles={historyExamTitles}
        deciderNames={deciderNames}
        viewerUid={viewerUid}
      />
    </div>
  );
}

const DECISION_STYLES: Record<string, string> = {
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  granted: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  rejected: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-400",
};

/** Who approved/rejected/granted which retake, and when — including the viewer. */
function RetakeHistoryCard({
  history,
  studentNames,
  examTitles,
  deciderNames,
  viewerUid,
}: {
  history: Serialized<RetakeDecisionEntry>[];
  studentNames: Record<string, string>;
  examTitles: Record<string, string>;
  deciderNames: Record<string, string>;
  viewerUid?: string;
}) {
  if (history.length === 0) return null;

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HistoryIcon className="size-4 text-muted-foreground" />
          Decision history
        </CardTitle>
        <CardDescription>
          Every retake decision in your scope — who made it and when, your own
          included.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {history.map((entry) => {
            const when = entry.decidedAt ? parseDate(entry.decidedAt) : null;
            const decider =
              deciderNames[entry.decidedBy ?? ""] ??
              (entry.decidedBy ? "Unknown staff" : "—");
            const isSelf = viewerUid && entry.decidedBy === viewerUid;
            return (
              <div
                key={entry.id}
                className="hover:bg-accent/40 flex flex-wrap items-center justify-between gap-3 px-6 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {studentNames[entry.studentId] ?? "Unknown student"}
                    <span className="text-muted-foreground font-normal">
                      {" "}· {examTitles[entry.examId] ?? "Unknown exam"}
                    </span>
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {when ? format(when, "d MMM yyyy, HH:mm") : "—"}
                    {" · by "}
                    <span className="font-medium text-foreground">{decider}</span>
                    {isSelf ? " (you)" : ""}
                    {entry.via === "direct" ? " · granted directly" : ""}
                  </p>
                </div>
                <span
                  className={
                    "rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize " +
                    (DECISION_STYLES[entry.decision] ?? "")
                  }
                >
                  {entry.decision}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
