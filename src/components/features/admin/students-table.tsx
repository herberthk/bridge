"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  BanIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CircleCheckIcon,
  MoreHorizontalIcon,
  PauseIcon,
  SearchIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  UserRoundPlusIcon,
  UsersIcon,
  XIcon,
} from "lucide-react";

import {
  setUserStatusAction,
  type ActionState,
} from "@/app/admin/actions";
import { CreateStudentDialog, type CreatableClass } from "@/components/features/admin/create-student-dialog";
import type { Role, UserStatus } from "@/lib/constants";
import type { UserDoc } from "@/types/firestore";
import { parseDate, type SerializedWithId } from "@/lib/serialize";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectDisplay,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ─── Types ─────────────────────────────────────────────────────────────────────

type SortField = "displayName" | "classLevel" | "status" | "lastLoginAt" | "createdAt";
type SortDir = "asc" | "desc";

// ─── Constants ──────────────────────────────────────────────────────────────────

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "banned", label: "Banned" },
];

const LEVEL_FILTER_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "all", label: "All levels" },
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
];

const STATUS_CONFIG: Record<
  UserStatus,
  {
    label: string;
    icon: React.ElementType;
    className: string;
  }
> = {
  active: {
    label: "Active",
    icon: ShieldCheckIcon,
    className:
      "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-400",
  },
  suspended: {
    label: "Suspended",
    icon: PauseIcon,
    className:
      "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-400",
  },
  banned: {
    label: "Banned",
    icon: ShieldOffIcon,
    className:
      "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-500",
  "bg-blue-500",
  "bg-cyan-500",
  "bg-emerald-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-teal-500",
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffffffff;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatClassLevel(s: SerializedWithId<UserDoc>): string {
  if (s.level === "primary") return `P${s.classLevel ?? "–"}`;
  if (s.level === "secondary")
    return `S${s.classLevel ?? "–"} · ${s.secondarySubLevel === "a_level" ? "A Level" : "O Level"}`;
  return "–";
}

/** Builds the compact page window: e.g. [1, 2, "…", 9, 10] */
function buildPageWindows(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const WING = 1;
  const pages: (number | "…")[] = [];
  const left = Math.max(2, current - WING);
  const right = Math.min(total - 1, current + WING);
  pages.push(1);
  if (left > 2) pages.push("…");
  for (let p = left; p <= right; p++) pages.push(p);
  if (right < total - 1) pages.push("…");
  pages.push(total);
  return pages;
}

// ─── Avatar ─────────────────────────────────────────────────────────────────────

function StudentAvatar({ student }: { student: SerializedWithId<UserDoc> }) {
  if (student.photoURL) {
    return (
      <img
        src={student.photoURL}
        alt={student.displayName}
        className="size-9 rounded-full object-cover ring-2 ring-border"
      />
    );
  }
  const color = getAvatarColor(student.id);
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${color}`}
    >
      {getInitials(student.displayName)}
    </span>
  );
}

// ─── Stat Pill ───────────────────────────────────────────────────────────────────

function StatPill({ count, label, colorClass }: { count: number; label: string; colorClass: string }) {
  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${colorClass}`}>
      <span className="text-lg font-bold tabular-nums leading-none">{count}</span>
      <span className="text-xs font-medium opacity-80">{label}</span>
    </div>
  );
}

// ─── Sortable Header ─────────────────────────────────────────────────────────────

function SortableHead({
  field,
  children,
  sortField,
  sortDir,
  onSort,
  className,
}: {
  field: SortField;
  children: React.ReactNode;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  className?: string;
}) {
  const active = sortField === field;
  const Icon = active
    ? sortDir === "asc" ? ArrowUpIcon : ArrowDownIcon
    : ArrowUpDownIcon;
  return (
    <TableHead className={className}>
      <button
        onClick={() => onSort(field)}
        className={`group inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide transition-colors ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {children}
        <Icon
          className={`size-3 transition-opacity ${
            active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
          }`}
        />
      </button>
    </TableHead>
  );
}

// ─── Row Actions ──────────────────────────────────────────────────────────────────

function StudentRowActions({
  student,
  canModerate = true,
}: {
  student: SerializedWithId<UserDoc>;
  canModerate?: boolean;
}) {
  const [banOpen, setBanOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState | null, FormData>(
    setUserStatusAction,
    null,
  );

  useEffect(() => {
    if (!state) return;
    if (state.ok) toast.success("Student updated.");
    else toast.error(state.error);
  }, [state]);

  const submit = (
    status: UserStatus,
    extra?: { reason?: string; suspendedUntil?: string },
  ) => {
    const fd = new FormData();
    fd.set("userId", student.id);
    fd.set("status", status);
    if (extra?.reason) fd.set("reason", extra.reason);
    if (extra?.suspendedUntil) fd.set("suspendedUntil", extra.suspendedUntil);
    formAction(fd);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
          <MoreHorizontalIcon />
          <span className="sr-only">Actions for {student.displayName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Manage</DropdownMenuLabel>
          {student.status !== "active" && (
            <DropdownMenuItem onClick={() => submit("active")}>
              <CircleCheckIcon data-icon="inline-start" />
              Reactivate
            </DropdownMenuItem>
          )}
          {canModerate && student.status === "active" && (
            <DropdownMenuItem
              onClick={() =>
                submit("suspended", {
                  suspendedUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
                })
              }
            >
              <PauseIcon data-icon="inline-start" />
              Suspend 7 days
            </DropdownMenuItem>
          )}
          {canModerate && student.status !== "banned" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setBanOpen(true)}>
                <BanIcon data-icon="inline-start" />
                Ban…
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={banOpen} onOpenChange={setBanOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ban {student.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              The student will be signed out immediately and unable to sign in
              until unbanned. This is used for serious exam-integrity violations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              render={<Button variant="destructive" />}
              onClick={() => submit("banned", { reason: "Banned by administrator" })}
            >
              Ban student
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────────

export function StudentsTable({
  students,
  viewerRole,
  total = null,
  fixedClassId,
  fixedClassName,
  classes = [],
}: {
  students: SerializedWithId<UserDoc>[];
  viewerRole: Role;
  /** Exact count when available — lets us show "X of Y" on capped lists. */
  total: number | null;
  /** When set (class dashboards), new students are created straight into this class. */
  fixedClassId?: string;
  /** Display name for the pinned class (class dashboards). */
  fixedClassName?: string;
  /**
   * Classes offered in the standalone "Add student" dialog — already scoped
   * by the caller (assigned-only for teachers, whole school for admins).
   */
  classes?: CreatableClass[];
}) {
  // ── Filter / search ──────────────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<UserStatus | "all">("all");
  const [levelFilter, setLevelFilter] = useState<"all" | "primary" | "secondary">("all");

  // ── Sort ─────────────────────────────────────────────────────────────────────
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Pagination ───────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // ── Derived: filtered + sorted list ─────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return students.filter((s) => {
      if (statusFilter !== "all" && s.status !== statusFilter) return false;
      if (levelFilter !== "all" && s.level !== levelFilter) return false;
      if (q && !s.displayName.toLowerCase().includes(q) && !s.email.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [students, query, statusFilter, levelFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "displayName": cmp = a.displayName.localeCompare(b.displayName); break;
        case "classLevel": cmp = (a.classLevel ?? 0) - (b.classLevel ?? 0); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
        case "lastLoginAt": {
          const at = a.lastLoginAt ? (parseDate(a.lastLoginAt)?.getTime() ?? 0) : 0;
          const bt = b.lastLoginAt ? (parseDate(b.lastLoginAt)?.getTime() ?? 0) : 0;
          cmp = at - bt; break;
        }
        case "createdAt": {
          const at = a.createdAt ? (parseDate(a.createdAt)?.getTime() ?? 0) : 0;
          const bt = b.createdAt ? (parseDate(b.createdAt)?.getTime() ?? 0) : 0;
          cmp = at - bt; break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  // ── Pagination math ───────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageItems = sorted.slice(pageStart, pageStart + pageSize);

  // Reset to page 1 when any filter/sort/page-size changes
  const filterKey = `${query}|${statusFilter}|${levelFilter}|${sortField}|${sortDir}|${pageSize}`;
  const [lastKey, setLastKey] = useState(filterKey);
  if (filterKey !== lastKey) { setLastKey(filterKey); if (page !== 1) setPage(1); }

  function handleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortField(field); setSortDir("asc"); }
  }

  // ── Stat counts ───────────────────────────────────────────────────────────────
  const activeCount = students.filter((s) => s.status === "active").length;
  const suspendedCount = students.filter((s) => s.status === "suspended").length;
  const bannedCount = students.filter((s) => s.status === "banned").length;

  const truncated = total !== null && students.length < total;
  const hasFilters = query || statusFilter !== "all" || levelFilter !== "all";

  return (
    <div className="flex flex-col gap-6">

      {/* ── Page Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UsersIcon className="size-5" />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
          </div>
          <p className="text-muted-foreground ml-0.5 mt-0.5 text-sm">
            {truncated
              ? `Showing ${students.length} of ${total} students`
              : `${students.length} student${students.length === 1 ? "" : "s"}`}
            {" · "}
            {viewerRole === "super_admin"
              ? "across the platform"
              : viewerRole === "teacher"
                ? "at your school"
                : "managed by you"}
          </p>
        </div>
        <CreateStudentDialog
          classes={classes}
          fixedClassId={fixedClassId}
          fixedClassName={fixedClassName}
        />
      </div>

      {/* ── Stat Pills ────────────────────────────────────────────────────────────── */}
      {students.length > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatPill
            count={activeCount}
            label="Active"
            colorClass="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          />
          <StatPill
            count={suspendedCount}
            label="Suspended"
            colorClass="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
          />
          <StatPill
            count={bannedCount}
            label="Banned"
            colorClass="border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
          />
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────────────────────────────────── */}
      {students.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Search */}
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email…"
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

          {/* Status filter */}
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as UserStatus | "all")}>
            <SelectTrigger className="w-[160px]">
              <ActivityIcon className="size-4 shrink-0 text-muted-foreground" />
              <SelectDisplay
                value={statusFilter}
                placeholder="All statuses"
                options={STATUS_FILTER_OPTIONS}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="suspended">Suspended</SelectItem>
              <SelectItem value="banned">Banned</SelectItem>
            </SelectContent>
          </Select>

          {/* Level filter */}
          <Select value={levelFilter} onValueChange={(v) => setLevelFilter(v as "all" | "primary" | "secondary")}>
            <SelectTrigger className="w-[160px]">
              <SelectDisplay
                value={levelFilter}
                placeholder="All levels"
                options={LEVEL_FILTER_OPTIONS}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="primary">Primary</SelectItem>
              <SelectItem value="secondary">Secondary</SelectItem>
            </SelectContent>
          </Select>

          {/* Page size */}
          <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
            <SelectTrigger className="w-[110px]">
              <SelectDisplay
                value={String(pageSize)}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: `${n} / page` }))}
              />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((n) => (
                <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* ── Table Card ────────────────────────────────────────────────────────────── */}
      <div className="shadow-card overflow-hidden rounded-xl border bg-card">
        {students.length === 0 ? (
          /* Zero students */
          <div className="flex flex-col items-center gap-4 p-16 text-center">
            <span className="bg-brand-soft flex size-14 items-center justify-center rounded-2xl text-primary">
              <UserRoundPlusIcon className="size-7" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">No students yet</p>
              <p className="text-muted-foreground max-w-xs text-sm text-pretty">
                Add your first student — they&apos;ll be able to sign in and take
                the exams you assign.
              </p>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          /* Filters returned nothing */
          <div className="flex flex-col items-center gap-4 p-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
              <SearchIcon className="size-7" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="font-semibold">No matching students</p>
              <p className="text-muted-foreground text-sm">
                Try adjusting your search or filters.
              </p>
            </div>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setQuery(""); setStatusFilter("all"); setLevelFilter("all"); }}
              >
                <XIcon data-icon="inline-start" />
                Clear filters
              </Button>
            )}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-b bg-muted/40">
                  <SortableHead field="displayName" sortField={sortField} sortDir={sortDir} onSort={handleSort} className="pl-5">
                    Student
                  </SortableHead>
                  <SortableHead field="classLevel" sortField={sortField} sortDir={sortDir} onSort={handleSort}>
                    Class
                  </SortableHead>
                  <SortableHead field="status" sortField={sortField} sortDir={sortDir} onSort={handleSort}>
                    Status
                  </SortableHead>
                  <SortableHead field="lastLoginAt" sortField={sortField} sortDir={sortDir} onSort={handleSort}>
                    Last login
                  </SortableHead>
                  <SortableHead field="createdAt" sortField={sortField} sortDir={sortDir} onSort={handleSort}>
                    Joined
                  </SortableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageItems.map((s) => {
                  const cfg = STATUS_CONFIG[s.status];
                  const StatusIcon = cfg.icon;
                  const lastLoginDate = parseDate(s.lastLoginAt);
                  const joinedDate = parseDate(s.createdAt);
                  return (
                    <TableRow key={s.id} className="group transition-colors hover:bg-muted/30">
                      {/* Student */}
                      <TableCell className="pl-5">
                        <div className="flex items-center gap-3">
                          <StudentAvatar student={s} />
                          <div className="flex flex-col">
                            <span className="font-medium leading-tight">{s.displayName}</span>
                            <span className="text-xs leading-tight text-muted-foreground">{s.email}</span>
                          </div>
                        </div>
                      </TableCell>

                      {/* Class */}
                      <TableCell>
                        <span className="rounded-md bg-muted/60 px-2 py-0.5 text-xs font-medium tabular-nums">
                          {formatClassLevel(s)}
                        </span>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.className}`}>
                          <StatusIcon className="size-3 shrink-0" />
                          {cfg.label}
                        </span>
                      </TableCell>

                      {/* Last login */}
                      <TableCell className="tabular-nums text-sm text-muted-foreground">
                        {lastLoginDate
                          ? format(lastLoginDate, "d MMM yyyy, HH:mm")
                          : <span className="italic text-xs text-muted-foreground/60">Never</span>}
                      </TableCell>

                      {/* Joined */}
                      <TableCell className="tabular-nums text-sm text-muted-foreground">
                        {joinedDate ? format(joinedDate, "d MMM yyyy") : "–"}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="pr-3">
                        <StudentRowActions
                          student={s}
                          canModerate={viewerRole === "admin" || viewerRole === "super_admin"}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {/* ── Pagination Bar ──────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between border-t bg-muted/20 px-5 py-3">
              {/* Result info */}
              <p className="text-xs tabular-nums text-muted-foreground">
                {sorted.length === 0
                  ? "No results"
                  : `${pageStart + 1}–${Math.min(pageStart + pageSize, sorted.length)} of ${sorted.length}`}
                {hasFilters && students.length !== sorted.length && (
                  <span className="ml-1 opacity-60">(filtered from {students.length})</span>
                )}
              </p>

              {/* Page controls */}
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" onClick={() => setPage(1)} disabled={safePage === 1} aria-label="First page">
                  <ChevronsLeftIcon className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} aria-label="Previous page">
                  <ChevronLeftIcon className="size-4" />
                </Button>

                <div className="flex items-center gap-0.5">
                  {buildPageWindows(safePage, totalPages).map((item, i) =>
                    item === "…" ? (
                      <span key={`ellipsis-${i}`} className="flex w-8 items-center justify-center text-sm text-muted-foreground">…</span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => setPage(item as number)}
                        aria-label={`Page ${item}`}
                        aria-current={safePage === item ? "page" : undefined}
                        className={`flex size-8 items-center justify-center rounded-md text-sm font-medium transition-colors ${
                          safePage === item
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        {item}
                      </button>
                    ),
                  )}
                </div>

                <Button variant="ghost" size="icon-sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} aria-label="Next page">
                  <ChevronRightIcon className="size-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => setPage(totalPages)} disabled={safePage === totalPages} aria-label="Last page">
                  <ChevronsRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Truncation notice ──────────────────────────────────────────────────────── */}
      {truncated && (
        <p className="text-center text-xs text-muted-foreground">
          Only the most recent {students.length} students are shown.
          {total !== null && ` ${total - students.length} older records are not displayed.`}
        </p>
      )}
    </div>
  );
}
