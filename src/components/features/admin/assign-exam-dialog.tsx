"use client";

import Link from "next/link";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CalendarClockIcon,
  CheckCircle2Icon,
  CheckSquare2Icon,
  ClipboardCheckIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import {
  assignExamAction,
  getAssignedStudentIdsAction,
  unassignExamAction,
  type ActionState,
} from "@/app/admin/actions";
import { SUBJECT_LABELS } from "@/lib/constants";
import { isStudentInExamScope } from "@/lib/exam/assignment-scope";
import { reviewProgress } from "@/lib/exam/review";
import type { SerializedWithId } from "@/lib/serialize";
import type { ExamDoc, UserDoc } from "@/types/firestore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * Assign an exam to students — modern, high-performance modal with smart pre-selection,
 * hard class scoping, responsive non-clipped layout, and real-time filtering.
 *
 * The roster is restricted to the exam's own class (exact `classId` match), so a
 * paper generated for Senior One can never be handed to Senior Two students —
 * for teachers and admins alike. Students already assigned stay visible even if
 * they have since moved class, so earlier work never vanishes from the list.
 */
export function AssignExamDialog({
  exam,
  students,
  assignedStudentIds = [],
  size = "sm",
  variant = "outline",
  label = "Assign",
  className,
  open: controlledOpen,
  onOpenChange,
  basePath = "/admin",
}: {
  exam: SerializedWithId<ExamDoc>;
  students: SerializedWithId<UserDoc>[];
  assignedStudentIds?: string[];
  size?: "sm" | "default" | "lg";
  variant?: "outline" | "default" | "secondary";
  label?: string;
  className?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  basePath?: string;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );

  // Track assigned student IDs with local optimistic updates
  const [localAssignedIds, setLocalAssignedIds] = useState<string[]>(assignedStudentIds);
  const [, startTransition] = useTransition();
  const lastHandledStateRef = useRef<ActionState | null>(null);
  const fetchedExamIdRef = useRef<string | null>(null);

  // Keep local assigned IDs in sync with props
  useEffect(() => {
    if (assignedStudentIds && assignedStudentIds.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLocalAssignedIds((prev) => {
        const set = new Set([...prev, ...assignedStudentIds]);
        if (set.size === prev.length) return prev;
        return Array.from(set);
      });
    }
  }, [assignedStudentIds]);

  // If dialog is opened and assignedStudentIds wasn't provided or might be stale, lazily fetch once
  useEffect(() => {
    if (open && localAssignedIds.length === 0 && fetchedExamIdRef.current !== exam.id) {
      fetchedExamIdRef.current = exam.id;
      startTransition(async () => {
        const res = await getAssignedStudentIdsAction(exam.id);
        if (res.ok && res.studentIds.length > 0) {
          setLocalAssignedIds((prev) => {
            const set = new Set([...prev, ...res.studentIds]);
            if (set.size === prev.length) return prev;
            return Array.from(set);
          });
        }
      });
    }
  }, [open, exam.id, localAssignedIds.length]);

  // Set-based lookup for O(1) performance
  const assignedSet = useMemo(() => new Set(localAssignedIds), [localAssignedIds]);

  // Selection state
  const [selected, setSelected] = useState<string[]>(() => localAssignedIds);

  // Assigned students the staffer has unchecked: staged for withdrawal, not
  // removed until the warning banner's Continue is pressed.
  const [pendingUnassign, setPendingUnassign] = useState<string[]>([]);
  const [unassigning, setUnassigning] = useState(false);

  // When dialog opens or assigned students update, ensure already assigned students are checked
  useEffect(() => {
    if (open && localAssignedIds.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected((prev) => {
        const missing = localAssignedIds.some((id) => !prev.includes(id));
        if (!missing) return prev;
        const combined = new Set([...prev, ...localAssignedIds]);
        return Array.from(combined);
      });
    }
  }, [open, localAssignedIds]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "unassigned" | "assigned">("all");

  // Review override acknowledgment
  const [acknowledged, setAcknowledged] = useState(false);

  // Form action
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    assignExamAction,
    null,
  );

  // Hard class scope: only the exam's own class is ever listed, selectable,
  // or counted here. The `students` prop still carries the school roster (the
  // library shares one list across many exams), so the restriction lives at the
  // point of selection rather than the point of fetch.
  const scopedStudents = useMemo(
    () => students.filter((s) => isStudentInExamScope(s, exam, assignedSet)),
    [students, exam, assignedSet],
  );

  const activeStudents = useMemo(
    () => scopedStudents.filter((s) => s.status === "active"),
    [scopedStudents],
  );

  // Helper to check if a student matches the exam's exact class level
  const matchesExamClass = useCallback(
    (s: SerializedWithId<UserDoc>) =>
      s.level === exam.params.level && s.classLevel === exam.params.classLevel,
    [exam.params.level, exam.params.classLevel],
  );

  // Fast Set for current selection
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  // Only newly assigned students (unassigned students who are selected)
  const unassignedSelected = useMemo(
    () => selected.filter((id) => !assignedSet.has(id)),
    [selected, assignedSet],
  );

  // Review gate check
  const progress = useMemo(
    () => reviewProgress(exam.questions, exam.review),
    [exam.questions, exam.review],
  );
  const gated = exam.status === "draft" && !progress.complete;
  const blocked = gated && !acknowledged;

  // Handle successful assignment
  useEffect(() => {
    if (!state || state === lastHandledStateRef.current) return;
    lastHandledStateRef.current = state;

    if (state.ok) {
      const assignedCount = state.createdCount ?? state.assignedIds?.length ?? 0;
      toast.success(
        assignedCount > 0
          ? `Exam successfully assigned to ${assignedCount} student${assignedCount === 1 ? "" : "s"}.`
          : "The exam has been assigned to the students.",
      );
      // Optimistically add the newly assigned IDs
      if (state.assignedIds && state.assignedIds.length > 0) {
        const newlyAssigned = state.assignedIds;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setLocalAssignedIds((prev) => {
          const set = new Set([...prev, ...newlyAssigned]);
          if (set.size === prev.length) return prev;
          return Array.from(set);
        });
      }
      setOpen(false);
      setAcknowledged(false);
    } else {
      toast.error(state.error ?? "Could not assign exam. Please try again.");
    }
  }, [state, setOpen]);

  // Filtered students computation
  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeStudents.filter((s) => {
      // Search filter
      if (q) {
        const nameMatch = s.displayName?.toLowerCase().includes(q);
        const emailMatch = s.email?.toLowerCase().includes(q);
        if (!nameMatch && !emailMatch) return false;
      }

      // Status filter
      const isAssigned = assignedSet.has(s.id);
      if (statusFilter === "unassigned" && isAssigned) return false;
      if (statusFilter === "assigned" && !isAssigned) return false;

      return true;
    });
  }, [activeStudents, searchQuery, statusFilter, assignedSet]);

  // Counts for UI indicators
  const totalAssignedCount = useMemo(
    () => activeStudents.filter((s) => assignedSet.has(s.id)).length,
    [activeStudents, assignedSet],
  );
  const totalUnassignedCount = activeStudents.length - totalAssignedCount;

  const matchingUnassignedStudents = useMemo(
    () => activeStudents.filter((s) => matchesExamClass(s) && !assignedSet.has(s.id)),
    [activeStudents, matchesExamClass, assignedSet],
  );

  // Quick Action: Select all unassigned matching class
  const selectAllMatching = useCallback(() => {
    setSelected((prev) => {
      const set = new Set(prev);
      matchingUnassignedStudents.forEach((s) => set.add(s.id));
      return Array.from(set);
    });
    toast.info(`Selected ${matchingUnassignedStudents.length} matching students.`);
  }, [matchingUnassignedStudents]);

  // Quick Action: Select all currently filtered unassigned students
  const selectAllFilteredUnassigned = useCallback(() => {
    const unassignedInView = filteredStudents.filter((s) => !assignedSet.has(s.id));
    if (unassignedInView.length === 0) {
      toast.info("No unassigned students in current view.");
      return;
    }
    setSelected((prev) => {
      const set = new Set(prev);
      unassignedInView.forEach((s) => set.add(s.id));
      return Array.from(set);
    });
    toast.info(`Selected ${unassignedInView.length} students.`);
  }, [filteredStudents, assignedSet]);

  // Quick Action: Clear all unassigned selections
  const clearUnassignedSelections = useCallback(() => {
    setSelected((prev) => prev.filter((id) => assignedSet.has(id)));
    toast.info("Cleared unassigned selections.");
  }, [assignedSet]);

  // Toggle individual student checkbox. Unchecking an already-assigned
  // student does not remove them immediately — it stages them for withdrawal
  // and raises the warning banner; re-checking cancels the staging.
  const toggleStudent = useCallback(
    (studentId: string) => {
      const wasAssigned = assignedSet.has(studentId);
      setSelected((prev) =>
        prev.includes(studentId)
          ? prev.filter((id) => id !== studentId)
          : [...prev, studentId],
      );
      if (wasAssigned) {
        setPendingUnassign((prev) =>
          prev.includes(studentId)
            ? prev.filter((id) => id !== studentId)
            : [...prev, studentId],
        );
      }
    },
    [assignedSet],
  );

  // Students staged for withdrawal, with names for the warning banner.
  const pendingUnassignStudents = useMemo(
    () => scopedStudents.filter((s) => pendingUnassign.includes(s.id)),
    [scopedStudents, pendingUnassign],
  );

  // Dismiss the banner and restore every staged checkbox.
  const cancelUnassign = useCallback(() => {
    setSelected((prev) => Array.from(new Set([...prev, ...pendingUnassign])));
    setPendingUnassign([]);
  }, [pendingUnassign]);

  // Confirmed in the banner: delete pending attempts, keep started ones.
  const confirmUnassign = useCallback(() => {
    const ids = pendingUnassign;
    if (ids.length === 0 || unassigning) return;
    setUnassigning(true);
    startTransition(async () => {
      const res = await unassignExamAction(exam.id, ids);
      setUnassigning(false);
      if (!res.ok) {
        toast.error(res.error ?? "Could not withdraw the exam. Please try again.");
        return;
      }
      const removed = res.removedIds ?? [];
      const skipped = res.skippedIds ?? [];
      setLocalAssignedIds((prev) => prev.filter((id) => !removed.includes(id)));
      setSelected((prev) => prev.filter((id) => !removed.includes(id)));
      setPendingUnassign((prev) => prev.filter((id) => !removed.includes(id)));
      if (removed.length > 0) {
        toast.success(
          `Exam withdrawn from ${removed.length} student${removed.length === 1 ? "" : "s"}.`,
        );
      }
      if (skipped.length > 0) {
        toast.info(
          `${skipped.length} student${skipped.length === 1 ? "" : "s"} already started — kept. Only pending assignments are withdrawn.`,
          { duration: 8000 },
        );
      }
    });
  }, [pendingUnassign, unassigning, exam.id]);

  // Class label helper (e.g. Primary P.7 or Secondary S.4)
  const formatClassBadge = (s: SerializedWithId<UserDoc>) => {
    if (s.level === "primary") return `P.${s.classLevel}`;
    return `S.${s.classLevel}`;
  };

  const examClassLabel =
    exam.params.level === "primary" ? `P.${exam.params.classLevel}` : `S.${exam.params.classLevel}`;

  // Subject label
  const subjectName =
    SUBJECT_LABELS[exam.params.subject as keyof typeof SUBJECT_LABELS] ?? exam.params.subject;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setAcknowledged(false);
          setSearchQuery("");
          // Discard any staged withdrawal and restore its checkboxes.
          if (pendingUnassign.length > 0) {
            setSelected((prev) => Array.from(new Set([...prev, ...pendingUnassign])));
          }
          setPendingUnassign([]);
        }
      }}
    >
      <DialogTrigger render={<Button size={size} variant={variant} className={className} />}>
        <SendIcon data-icon="inline-start" />
        {label}
      </DialogTrigger>

      <DialogContent className="w-[95vw] sm:w-full sm:max-w-160 md:max-w-220 p-0 overflow-hidden border-border/80 bg-linear-to-b from-card to-card/95 shadow-2xl rounded-2xl">
        {/* ── Modal Header with Gradient Accent & Clear Spacing ── */}
        <div className="relative border-b border-border/60 bg-linear-to-r from-primary/10 via-primary/5 to-transparent px-5 sm:px-6 pt-6 pb-5 pr-14">
          <div className="flex items-start gap-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary ring-1 ring-primary/25 shadow-xs">
              <SendIcon className="size-5" />
            </div>
            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <DialogTitle className="text-base font-semibold tracking-tight text-foreground truncate">
                Assign “{exam.title}”
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground line-clamp-1">
                Create student exam attempts with automated proctoring and performance tracking.
              </DialogDescription>
            </div>
          </div>

          {/* Exam Parameter Pills */}
          <div className="mt-3.5 flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline" className="bg-background/80 font-medium text-foreground">
              {subjectName}
            </Badge>
            <Badge variant="secondary" className="bg-primary/10 text-primary border-primary/20 font-medium">
              Target: {examClassLabel}
            </Badge>
            <Badge variant="outline" className="bg-background/80 text-muted-foreground">
              {exam.questions.length} questions
            </Badge>
            <Badge variant="outline" className="bg-background/80 text-muted-foreground">
              {exam.params.durationMinutes} mins
            </Badge>
          </div>
        </div>

        <form action={formAction} className="flex flex-col w-full min-w-0">
          <input type="hidden" name="examId" value={exam.id} />
          {/* ONLY submit student IDs who are NOT already assigned */}
          {unassignedSelected.map((id) => (
            <input key={id} type="hidden" name="studentIds" value={id} />
          ))}
          {acknowledged && (
            <input type="hidden" name="acknowledgeUnreviewed" value="true" />
          )}

          <div className="flex flex-col gap-4 p-5 sm:p-6 pt-4 w-full min-w-0">
            {/* ── Review Gate Warning Banner ── */}
            {gated && (
              <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 shadow-xs backdrop-blur-xs">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-amber-800 dark:text-amber-300 text-xs sm:text-sm">
                      {progress.pendingIds.length} question
                      {progress.pendingIds.length === 1 ? "" : "s"} not yet reviewed
                    </p>
                    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-300 text-[10px]">
                      Draft Status
                    </Badge>
                  </div>
                  <p className="text-xs text-amber-900/80 dark:text-amber-200/80 leading-relaxed">
                    {acknowledged
                      ? "You are assigning this exam with unreviewed questions. This override will be recorded in the audit trail."
                      : "We recommend reviewing all questions before student distribution, or confirm assignment to proceed."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 border-amber-500/30 bg-background/80 text-xs text-foreground hover:bg-background"
                      render={<Link href={`${basePath}/exams/${exam.id}/review`} />}
                    >
                      <ClipboardCheckIcon data-icon="inline-start" className="size-3.5 text-amber-600" />
                      Review questions
                    </Button>
                    {!acknowledged && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-700 dark:text-amber-400 hover:bg-amber-500/15"
                        onClick={() => setAcknowledged(true)}
                      >
                        Assign anyway
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ── Withdrawal Warning Banner ── */}
            {pendingUnassignStudents.length > 0 && (
              <div
                role="alert"
                className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 shadow-xs"
              >
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm">
                  <p className="font-semibold text-rose-800 dark:text-rose-300 text-xs sm:text-sm">
                    Withdraw “{exam.title}” from {pendingUnassignStudents.length} student
                    {pendingUnassignStudents.length === 1 ? "" : "s"}?
                  </p>
                  <p className="text-xs text-rose-900/80 dark:text-rose-200/80 leading-relaxed">
                    {pendingUnassignStudents
                      .slice(0, 3)
                      .map((s) => s.displayName || s.email || "Unnamed student")
                      .join(", ")}
                    {pendingUnassignStudents.length > 3 &&
                      ` and ${pendingUnassignStudents.length - 3} more `}
                    will lose access to this exam immediately. Only not-started
                    assignments are removed — anything already started,
                    submitted, or graded is never touched.
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      disabled={unassigning}
                      onClick={confirmUnassign}
                      className="h-7 bg-rose-600 text-xs text-white hover:bg-rose-700"
                    >
                      {unassigning ? (
                        <>
                          <Spinner className="size-3.5" />
                          Withdrawing…
                        </>
                      ) : (
                        <>
                          Yes, withdraw {pendingUnassignStudents.length} student
                          {pendingUnassignStudents.length === 1 ? "" : "s"}
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={unassigning}
                      onClick={cancelUnassign}
                      className="h-7 border-rose-500/30 bg-background/80 text-xs text-foreground hover:bg-background"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Student Search & Filter Controls ── */}
            <div className="flex flex-col gap-2.5 w-full min-w-0">
              {/* Search Bar & Quick Toggles */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full min-w-0">
                <div className="relative flex-1 min-w-0">
                  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
                  <Input
                    placeholder="Search students by name or email..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-8 h-9 text-xs w-full"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  )}
                </div>

                {/* Filter Tabs */}
                <div className="grid grid-cols-3 sm:flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 text-xs font-medium shrink-0">
                  <button
                    type="button"
                    onClick={() => setStatusFilter("all")}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-all text-center truncate",
                      statusFilter === "all"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    All ({activeStudents.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("unassigned")}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-all text-center truncate",
                      statusFilter === "unassigned"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Unassigned ({totalUnassignedCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter("assigned")}
                    className={cn(
                      "rounded-md px-2.5 py-1 transition-all text-center truncate",
                      statusFilter === "assigned"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Assigned ({totalAssignedCount})
                  </button>
                </div>
              </div>

              {/* Class & Quick Select Actions Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs w-full min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Fixed scope — not a toggle: this exam belongs to
                      {examClassLabel}, so no other class is selectable. */}
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                    <UsersIcon className="size-3" />
                    Only {examClassLabel} students
                  </span>

                  {matchingUnassignedStudents.length > 0 && (
                    <button
                      type="button"
                      onClick={selectAllMatching}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors font-medium"
                    >
                      <SparklesIcon className="size-3" />
                      Select all {matchingUnassignedStudents.length} {examClassLabel}
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-1.5 ml-auto shrink-0">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAllFilteredUnassigned}
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                  >
                    <CheckSquare2Icon className="size-3.5 mr-1" />
                    Select view
                  </Button>
                  {unassignedSelected.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearUnassignedSelections}
                      className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                    >
                      Clear ({unassignedSelected.length})
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* ── Student List (ScrollArea) ── */}
            <div className="rounded-xl border border-border/80 bg-background/50 overflow-hidden shadow-2xs w-full min-w-0">
              <div className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-2 text-xs font-medium text-muted-foreground w-full min-w-0">
                <span className="flex items-center gap-1.5 shrink-0">
                  <UsersIcon className="size-3.5" />
                  Student Directory ({filteredStudents.length})
                </span>
                <span className="text-[11px] font-normal text-muted-foreground truncate text-right">
                  <span className="text-primary font-semibold">{unassignedSelected.length}</span> new ·{" "}
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{totalAssignedCount}</span> assigned
                </span>
              </div>

              <ScrollArea className="h-56 sm:h-64 w-full">
                <div className="flex flex-col p-1.5 divide-y divide-border/40 w-full min-w-0">
                  {filteredStudents.length === 0 ? (
                    activeStudents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <UsersIcon className="size-8 text-muted-foreground/40 mb-2" />
                        <p className="text-sm font-medium text-foreground">
                          No active {examClassLabel} students yet
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-70">
                          This exam belongs to {examClassLabel}, and that class
                          has no active students to assign. Add students to the
                          class first, then come back.
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3 h-8 text-xs"
                          render={<Link href={`${basePath}/students`} />}
                        >
                          <UsersIcon data-icon="inline-start" className="size-3.5" />
                          Go to Students
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                        <UsersIcon className="size-8 text-muted-foreground/40 mb-2" />
                        <p className="text-sm font-medium text-foreground">No students found</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {searchQuery
                            ? "Try a different search keyword or adjust filters."
                            : "No active students available in this view."}
                        </p>
                      </div>
                    )
                  ) : (
                    filteredStudents.map((s) => {
                      const isAssigned = assignedSet.has(s.id);
                      const isChecked = selectedSet.has(s.id);
                      const isMatch = matchesExamClass(s);
                      const classPill = formatClassBadge(s);

                      // Initials for avatar
                      const initials = (s.displayName || s.email || "S")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase();

                      return (
                        <label
                          key={s.id}
                          className={cn(
                            "group flex items-center justify-between gap-2.5 rounded-lg px-3 py-2.5 transition-all cursor-pointer w-full min-w-0",
                            isAssigned
                              ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.07]"
                              : isChecked
                                ? "bg-primary/[0.05] hover:bg-primary/[0.08]"
                                : "hover:bg-accent/50",
                          )}
                        >
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <Checkbox
                              checked={isChecked}
                              onCheckedChange={() => toggleStudent(s.id)}
                              className={cn(
                                isAssigned && "data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600",
                              )}
                            />

                            {/* Avatar */}
                            <div
                              className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold select-none",
                                isAssigned
                                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30"
                                  : isMatch
                                    ? "bg-primary/15 text-primary ring-1 ring-primary/25"
                                    : "bg-muted text-muted-foreground ring-1 ring-border",
                              )}
                            >
                              {initials}
                            </div>

                            {/* Info */}
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-xs font-semibold text-foreground truncate">
                                  {s.displayName || "Unnamed Student"}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 font-medium shrink-0",
                                    isMatch
                                      ? "border-primary/30 bg-primary/10 text-primary"
                                      : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                                  )}
                                >
                                  {classPill}
                                </Badge>
                              </div>
                              <span className="text-[11px] text-muted-foreground truncate">
                                {s.email}
                              </span>
                            </div>
                          </div>

                          {/* Status Pill */}
                          <div className="shrink-0 ml-2">
                            {isAssigned ? (
                              <Badge
                                variant="secondary"
                                className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-[11px] font-medium gap-1 py-0.5"
                              >
                                <CheckCircle2Icon className="size-3 text-emerald-600 dark:text-emerald-400" />
                                Assigned
                              </Badge>
                            ) : isChecked ? (
                              <Badge
                                variant="outline"
                                className="border-primary/40 bg-primary/10 text-primary text-[11px] font-medium gap-1 py-0.5"
                              >
                                <SparklesIcon className="size-3" />
                                Ready
                              </Badge>
                            ) : null}
                          </div>
                        </label>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* ── Scheduling Field (Optional) ── */}
            <div className="rounded-xl border border-border/70 bg-muted/20 p-3.5 w-full min-w-0">
              <Field className="w-full min-w-0">
                <div className="flex items-center justify-between mb-1.5 w-full">
                  <FieldLabel
                    htmlFor={`scheduledFor-${exam.id}`}
                    className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
                  >
                    <CalendarClockIcon className="size-3.5 text-primary" />
                    Schedule Exam Release (Optional)
                  </FieldLabel>
                  <span className="text-[11px] text-muted-foreground">Default: Immediate</span>
                </div>
                <Input
                  id={`scheduledFor-${exam.id}`}
                  name="scheduledFor"
                  type="datetime-local"
                  className="h-9 text-xs bg-background w-full"
                />
                <FieldDescription className="text-[11px] text-muted-foreground mt-1">
                  Students will see this exam locked until the specified date and time.
                </FieldDescription>
              </Field>
            </div>
          </div>

          {/* ── Modal Footer ── */}
          <DialogFooter className="border-t border-border/60 bg-muted/30 px-5 sm:px-6 py-4 flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 w-full min-w-0">
            <div className="text-xs text-muted-foreground w-full sm:w-auto text-center sm:text-left truncate min-w-0">
              {unassignedSelected.length > 0 ? (
                <span className="text-foreground font-medium truncate">
                  <span className="text-primary font-bold">{unassignedSelected.length}</span> new student
                  {unassignedSelected.length === 1 ? "" : "s"} will be assigned
                </span>
              ) : totalAssignedCount > 0 && selected.length > 0 ? (
                <span className="text-muted-foreground truncate">
                  All {selected.length} selected students already assigned
                </span>
              ) : (
                <span>No new students selected</span>
              )}
            </div>

            <div className="flex items-center gap-2.5 shrink-0 justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAcknowledged(false);
                  setOpen(false);
                }}
              >
                Cancel
              </Button>

              <Button
                type="submit"
                size="sm"
                disabled={pending || blocked || unassignedSelected.length === 0}
                className={cn(
                  "gap-1.5 font-medium transition-all shadow-xs shrink-0",
                  unassignedSelected.length > 0 && "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
                onClick={(e) => {
                  if (unassignedSelected.length === 0) {
                    e.preventDefault();
                    if (selected.length > 0 && totalAssignedCount > 0) {
                      toast.info("All selected students are already assigned to this exam.");
                    } else {
                      toast.error("Please select at least one student to assign.");
                    }
                  }
                }}
              >
                {pending ? (
                  <>
                    <Spinner className="size-3.5" />
                    Assigning…
                  </>
                ) : blocked ? (
                  "Review required"
                ) : unassignedSelected.length === 0 ? (
                  totalAssignedCount > 0 && selected.length > 0
                    ? "All selected already assigned"
                    : "Select students to assign"
                ) : (
                  <>
                    <SendIcon className="size-3.5" />
                    Assign to {unassignedSelected.length} student{unassignedSelected.length === 1 ? "" : "s"}
                  </>
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
