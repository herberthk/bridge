export const dynamic = "force-dynamic";

import { ExamGenerator } from "@/components/features/admin/exam-generator";

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
      <ExamGenerator />
    </div>
  );
}
