"use client";

import { memo, useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { format } from "date-fns";
import {
  ClipboardListIcon,
  RefreshCcwIcon,
  SearchIcon,
  UsersRoundIcon,
  XIcon,
} from "lucide-react";

import { revokeInviteAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { ClassDoc, InviteDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { filterTeachers, getAvatarColor, getInitials } from "@/lib/admin-ui";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssignClassesDialog } from "@/components/features/school/assign-classes-dialog";
import { useActionToast } from "@/components/features/super/schools-manager";

/**
 * Shared empty managed-classes list. `classesByTeacher.get(t.id) ?? NO_CLASSES`
 * keeps the `managed` prop referentially stable for unassigned teachers so the
 * memoized `TeacherRow` actually skips re-renders while searching.
 */
const NO_CLASSES: SerializedWithId<ClassDoc>[] = [];

/** Teacher roster + pending invites management for school admins. */
export function TeachersManager({
  teachers,
  classes,
  pendingInvites,
  schoolName,
}: {
  teachers: SerializedWithId<UserDoc>[];
  classes: SerializedWithId<ClassDoc>[];
  pendingInvites: SerializedWithId<InviteDoc>[];
  schoolName: string;
}) {
  const [query, setQuery] = useState("");
  // Search typing stays responsive on large rosters — filtering runs as a
  // transition so keystrokes aren't blocked by table re-renders.
  const [, startSearchTransition] = useTransition();

  const handleQueryChange = (value: string) => {
    startSearchTransition(() => {
      setQuery(value);
    });
  };

  // Class lookup is stable across rows — build once instead of filtering
  // per teacher on every render.
  const classesByTeacher = useMemo(() => {
    const byClassId = new Map(classes.map((c) => [c.id, c]));
    const out = new Map<string, SerializedWithId<ClassDoc>[]>();
    for (const t of teachers) {
      const managed: SerializedWithId<ClassDoc>[] = [];
      for (const id of t.assignedClassIds ?? []) {
        const c = byClassId.get(id);
        if (c) managed.push(c);
      }
      out.set(t.id, managed);
    }
    return out;
  }, [teachers, classes]);

  const filteredTeachers = useMemo(
    () => filterTeachers(teachers, query),
    [teachers, query],
  );
  const unassignedCount = useMemo(
    () =>
      teachers.filter((t) => (t.assignedClassIds ?? []).length === 0).length,
    [teachers],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Insight strip — what needs attention at a glance. */}
      {teachers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary" className="font-normal tabular-nums">
            {teachers.length} {teachers.length === 1 ? "teacher" : "teachers"}
          </Badge>
          {unassignedCount > 0 && (
            <span className="text-muted-foreground">
              {unassignedCount} without classes — assign classes so they can
              manage students and exams.
            </span>
          )}
          {pendingInvites.length > 0 && (
            <span className="text-muted-foreground">
              {pendingInvites.length} invite{pendingInvites.length === 1 ? "" : "s"} awaiting
              acceptance (expire after 7 days).
            </span>
          )}
        </div>
      )}

      <Card className="shadow-card overflow-hidden">
        <CardHeader className="border-b bg-muted/20 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UsersRoundIcon className="size-4" />
                Teacher roster ({teachers.length})
              </CardTitle>
              <CardDescription className="text-xs">
                Teachers see {schoolName} in their dashboard and manage their
                assigned classes: students, exams, leaderboards and retakes.
              </CardDescription>
            </div>
            {teachers.length > 0 && (
              <div className="relative w-full sm:w-64">
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
                <Input
                  value={query}
                  onChange={(e) => handleQueryChange(e.target.value)}
                  placeholder="Search name or email…"
                  aria-label="Search teachers"
                  className="h-8 pl-8 text-xs"
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Clear teacher search"
                    onClick={() => setQuery("")}
                    className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {teachers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-12 text-center">
              <span className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-2xl">
                <UsersRoundIcon className="size-6" />
              </span>
              <div>
                <p className="font-semibold">No teachers yet</p>
                <p className="text-muted-foreground mt-1 max-w-sm text-sm text-pretty">
                  Invite your first teacher with the button above. They set
                  their own password via a secure link, then see {schoolName}{" "}
                  in their dashboard.
                </p>
              </div>
            </div>
          ) : filteredTeachers.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center">
              <SearchIcon className="text-muted-foreground/40 size-8" />
              <p className="font-medium">No teachers match “{query}”</p>
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Classes managed</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTeachers.map((t) => (
                  <TeacherRow
                    key={t.id}
                    teacher={t}
                    managed={classesByTeacher.get(t.id) ?? NO_CLASSES}
                    classes={classes}
                  />
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <PendingInvitesCard invites={pendingInvites} />
    </div>
  );
}

/** Memoized roster row — avatar + status + classes stay cheap on search typing. */
const TeacherRow = memo(function TeacherRow({
  teacher: t,
  managed,
  classes,
}: {
  teacher: SerializedWithId<UserDoc>;
  managed: SerializedWithId<ClassDoc>[];
  classes: SerializedWithId<ClassDoc>[];
}) {
  const color = getAvatarColor(t.id);
  // Blank display names fall back to "?" — deriving initials from the email
  // address would render noise like "M@".
  const avatarLabel = (t.displayName ?? "").trim();
  return (
    <TableRow className="hover:bg-muted/40 transition-colors">
      <TableCell>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${color}`}
          >
            {getInitials(avatarLabel || "?")}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-medium">{t.displayName}</span>
            <span className="text-muted-foreground truncate text-xs">{t.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={t.status === "active" ? "secondary" : "destructive"}>
          {t.status}
        </Badge>
      </TableCell>
      <TableCell>
        {managed.length === 0 ? (
          <span className="text-muted-foreground text-xs">None yet</span>
        ) : (
          <div className="flex max-w-64 flex-wrap gap-1">
            {managed.map((c) => (
              <Badge key={c.id} variant="outline" className="font-normal">
                {c.name}
              </Badge>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
        {t.createdAt ? format(new Date(t.createdAt as unknown as string), "d MMM yyyy") : "–"}
      </TableCell>
      <TableCell className="text-right">
        <AssignClassesDialog teacher={t} classes={classes} />
      </TableCell>
    </TableRow>
  );
});

/** Pending teacher invites with revoke. */
function PendingInvitesCard({ invites }: { invites: SerializedWithId<InviteDoc>[] }) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    revokeInviteAction,
    null,
  );
  // Captured once at mount — avoids calling the impure Date.now during render.
  const [nowMs] = useState(() => Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  useActionToast(state, undefined, "Invite revoked");
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <Card className="shadow-card overflow-hidden">
      <CardHeader className="border-b bg-muted/20 pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardListIcon className="size-4" />
          Pending invites ({invites.length})
        </CardTitle>
        <CardDescription className="text-xs">
          Links expire after 7 days and work once. Revoking stops an unused
          link immediately. Accepted invites move teachers into the roster above.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {invites.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">No pending invites — every invite has been accepted or revoked.</p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Classes</TableHead>
                <TableHead>Invited</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((invite) => {
                const expired =
                  invite.expiresAt &&
                  new Date(invite.expiresAt as unknown as string).getTime() <= nowMs;
                return (
                  <TableRow key={invite.id}>
                    <TableCell className="font-medium">{invite.email}</TableCell>
                    <TableCell>
                      {invite.classIds.length === 0 ? (
                        <span className="text-muted-foreground text-xs">—</span>
                      ) : (
                        <span className="text-xs">{invite.classIds.length} assigned</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {invite.createdAt
                        ? format(new Date(invite.createdAt as unknown as string), "d MMM")
                        : "–"}
                    </TableCell>
                    <TableCell>
                      {expired ? (
                        <Badge variant="destructive" className="gap-1">
                          <RefreshCcwIcon className="size-3" /> Expired
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {invite.expiresAt
                            ? format(new Date(invite.expiresAt as unknown as string), "d MMM, HH:mm")
                            : "–"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <form action={formAction} ref={formRef}>
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <Button type="submit" variant="outline" size="sm" disabled={pending}>
                          <XIcon data-icon="inline-start" />
                          Revoke
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
