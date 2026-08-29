import { Suspense } from "react";

import { ExamGenerator } from "@/components/features/admin/exam-generator";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminGeneratePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generate an exam</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Describe what you need — Gemini drafts a full, calibrated assessment
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
