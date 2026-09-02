"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ClipboardListIcon, RefreshCcwIcon, UsersRoundIcon, XIcon } from "lucide-react";

import { revokeInviteAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { ClassDoc, InviteDoc, UserDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Teachers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Everyone teaching at {schoolName} — assign the classes each teacher
          manages.
        </p>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UsersRoundIcon className="size-4" />
            Teacher roster ({teachers.length})
          </CardTitle>
          <CardDescription>
            Teachers see your school in their dashboard and manage their
            assigned classes: students, exams, leaderboards and retakes.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {teachers.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-10 text-center text-sm">
              <UsersRoundIcon className="text-muted-foreground/40 size-8" />
              No teachers yet — invite one with the button above.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Teacher</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Classes managed</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teachers.map((t) => {
                  const managed = classes.filter((c) =>
                    (t.assignedClassIds ?? []).includes(c.id),
                  );
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{t.displayName}</span>
                          <span className="text-muted-foreground text-xs">{t.email}</span>
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
                          <div className="flex flex-wrap gap-1">
                            {managed.map((c) => (
                              <Badge key={c.id} variant="outline">
                                {c.name}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {t.createdAt ? format(new Date(t.createdAt as unknown as string), "d MMM yyyy") : "–"}
                      </TableCell>
                      <TableCell className="text-right">
                        <AssignClassesDialog teacher={t} classes={classes} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PendingInvitesCard invites={pendingInvites} />
    </div>
  );
}

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
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClipboardListIcon className="size-4" />
          Pending invites ({invites.length})
        </CardTitle>
        <CardDescription>
          Links expire after 7 days and work once. Revoking stops an unused
          link immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {invites.length === 0 ? (
          <p className="text-muted-foreground p-6 text-sm">No pending invites.</p>
        ) : (
          <Table>
            <TableHeader>
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
        )}
      </CardContent>
    </Card>
  );
}
