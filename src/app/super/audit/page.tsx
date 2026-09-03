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
import { Pagination } from "@/components/features/super/pagination";
import type { WithId, AuditLogDoc } from "@/types/firestore";

const PAGE_SIZE = 100;

function encodeCursor(id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id })).toString("base64url");
}

function decodeCursor(cursor: string): string | null {
  if (cursor.length > 2_000) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "v" in value &&
      value.v === 1 &&
      "id" in value &&
      typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 1_500
    ) {
      return value.id;
    }
  } catch {
    // Invalid or tampered cursors fail closed in the page loader below.
  }
  return null;
}

/** Human-friendly label for audit actions (auth.login → Auth · Login). */
function actionLabel(action: string): string {
  return action
    .split(/[._]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");
}

export default async function SuperAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>;
}) {
  await requireRole("super_admin");
  const params = await searchParams;
  const cursor = params.cursor?.trim() || null;

  let entries: WithId<AuditLogDoc>[] = [];
  let previousCursor: string | null = null;
  let nextCursor: string | null = null;
  let loadError = false;
  try {
    const ordered = auditLogsCol().orderBy("createdAt", "desc");
    let pageQuery = ordered;

    if (cursor) {
      const cursorId = decodeCursor(cursor);
      if (!cursorId) throw new Error("Invalid audit log cursor.");
      const cursorSnap = await auditLogsCol().doc(cursorId).get();
      if (!cursorSnap.exists) throw new Error("Audit log cursor no longer exists.");

      pageQuery = ordered.startAfter(cursorSnap);
      const previousPage = await ordered.endBefore(cursorSnap).limitToLast(PAGE_SIZE).get();
      if (previousPage.size === PAGE_SIZE) {
        previousCursor = encodeCursor(previousPage.docs[0]!.id);
      }
    }

    const snap = await pageQuery.limit(PAGE_SIZE + 1).get();
    const visibleDocs = snap.docs.slice(0, PAGE_SIZE);
    entries = visibleDocs.map((d) => ({ id: d.id, ...d.data()! }));
    if (snap.size > PAGE_SIZE && visibleDocs.length > 0) {
      nextCursor = encodeCursor(visibleDocs.at(-1)!.id);
    }
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
          newest first.
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

      {!loadError && (
        <Pagination
          cursor={cursor}
          previousCursor={previousCursor}
          nextCursor={nextCursor}
        />
      )}
    </div>
  );
}
