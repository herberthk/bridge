"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, InboxIcon, XIcon } from "lucide-react";

import { decideRetakeAction } from "@/app/admin/actions";
import type { ActionState } from "@/app/admin/actions";
import type { RetakeRequestDoc } from "@/types/firestore";
import type { SerializedWithId } from "@/lib/serialize";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function RetakeRequests({
  requests,
  studentNames,
  examTitles,
}: {
  requests: SerializedWithId<RetakeRequestDoc>[];
  studentNames: Record<string, string>;
  examTitles: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState<ActionState | null, FormData>(
    decideRetakeAction,
    null,
  );
  const [, startTransition] = useTransition();
  const lastApproveRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      toast.success(lastApproveRef.current ? "Retake approved" : "Retake rejected");
    } else {
      toast.error(state.error);
    }
  }, [state]);

  const submit = (requestId: string, approve: boolean) => {
    const fd = new FormData();
    fd.set("requestId", requestId);
    fd.set("approve", String(approve));
    lastApproveRef.current = approve;
    startTransition(() => {
      formAction(fd);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Retake requests</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Approving creates a fresh attempt for the student.
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="shadow-card flex flex-col items-center gap-3 rounded-xl border bg-card p-12 text-center">
          <span className="bg-brand-soft flex size-12 items-center justify-center rounded-xl text-accent-foreground">
            <InboxIcon className="size-6" />
          </span>
          <p className="font-medium">No pending requests</p>
          <p className="text-muted-foreground max-w-sm text-sm">
            Students&apos; retake requests will appear here for approval.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {requests.map((r) => (
            <div
              key={r.id}
              className="shadow-card flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate font-medium">
                    {studentNames[r.studentId] ?? "Student"}
                  </p>
                  <Badge variant="secondary">{examTitles[r.examId] ?? "Exam"}</Badge>
                </div>
                <p className="text-muted-foreground mt-1 line-clamp-2 text-sm text-pretty">
                  “{r.reason}”
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="shadow-glow"
                  disabled={pending}
                  onClick={() => submit(r.id, true)}
                >
                  <CheckIcon data-icon="inline-start" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => submit(r.id, false)}
                >
                  <XIcon data-icon="inline-start" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
