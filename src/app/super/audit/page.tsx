export const dynamic = "force-dynamic";

import { format } from "date-fns";

import { auditLogsCol } from "@/server/firebase/collections";
import { requireRole } from "@/server/auth/session";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { timestampToDate } from "@/lib/serialize";
import type { WithId, AuditLogDoc } from "@/types/firestore";

const PAGE_SIZE = 100;

/** Human-friendly label for audit actions (auth.login → Auth · Login). */
function actionLabel(action: string): string {
  return action
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");
}

export default async function SuperAuditPage() {
  await requireRole("super_admin");

  let entries: WithId<AuditLogDoc>[] = [];
  let loadError = false;
  try {
    const snap = await auditLogsCol()
      .orderBy("createdAt", "desc")
      .limit(PAGE_SIZE)
      .get();
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data()! }));
  } catch (err) {
    console.error("[super/audit] load failed", err);
    loadError = true;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sign-ins, account changes, school provisioning, and wallet top-ups —
          newest first ({PAGE_SIZE} most recent).
        </p>
      </div>

      <div className="shadow-card rounded-xl border bg-card">
        {loadError ? (
          <p className="text-destructive py-10 text-center text-sm">
            Could not load the audit log. Try refreshing.
          </p>
        ) : entries.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            No audit entries yet — activity appears here as it happens.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => {
                const when = timestampToDate(e.createdAt);
                return (
                  <TableRow key={e.id}>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {when ? format(when, "d MMM yyyy, HH:mm") : "–"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={e.action.startsWith("auth.") ? "secondary" : "outline"}>
                        {actionLabel(e.action)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs">
                      {e.actorId ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-48 truncate text-xs">
                      {e.targetType ? `${e.targetType}: ${e.targetId ?? "?"}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground font-mono text-xs">
                      {e.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
