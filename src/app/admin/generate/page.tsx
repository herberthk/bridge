import { Suspense } from "react";
import { redirect } from "next/navigation";

import { ExamGenerator } from "@/components/features/admin/exam-generator";
import { Skeleton } from "@/components/ui/skeleton";
import { requireRole, type SessionUser } from "@/server/auth/session";
import { getClassForActor, listClasses } from "@/server/services/classes";
import { firstSearchParam, parseVoiceClassScope } from "@/lib/class-display";

type GenerateSearchParams = Record<string, string | string[] | undefined>;

/**
 * Resolve the voice-builder handoff (level + class year, no classId) to the
 * matching class. One class exists per year within a school, so a match is
 * unambiguous; anything else falls through to the class list.
 */
async function resolveVoiceClassId(
  params: GenerateSearchParams,
  actor: SessionUser,
): Promise<{ classId: string; className: string } | null> {
  const scope = parseVoiceClassScope(params);
  if (!scope) {
    return null;
  }
  const classes = await listClasses(actor).catch(() => []);
  const match = classes.find((c) => c.level === scope.level && c.classLevel === scope.classLevel);
  return match ? { classId: match.id, className: match.name } : null;
}

export default async function AdminGeneratePage({
  searchParams,
}: {
  searchParams: Promise<GenerateSearchParams>;
}) {
  const actor = await requireRole("admin");
  const params = await searchParams;
  const classId = firstSearchParam(params.classId);

  if (!classId) {
    const resolved = await resolveVoiceClassId(params, actor);
    if (resolved) {
      const next = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) {
          for (const v of value) next.append(key, v);
        } else if (value !== undefined) {
          next.set(key, value);
        }
      }
      next.set("classId", resolved.classId);
      next.set("className", resolved.className);
      redirect(`/admin/generate?${next.toString()}`);
    }
    redirect("/admin/classes");
  }

  try {
    await getClassForActor(actor, classId);
  } catch {
    redirect("/admin/classes");
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate an exam</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Describe what you need — AI drafts a full, calibrated assessment
          in seconds. Optionally ground it on your own past papers.
        </p>
      </div>
      {/*
        ExamGenerator reads voice-builder handoff params via `useSearchParams`,
        which needs a Suspense boundary. With one, the static shell above still
        prerenders; `force-dynamic` would have opted the whole route out.
      */}
      <Suspense fallback={<Skeleton className="h-128 w-full rounded-xl" />}>
        <ExamGenerator />
      </Suspense>
    </div>
  );
}
