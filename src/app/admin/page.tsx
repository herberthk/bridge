export const dynamic = "force-dynamic";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { SparklesIcon } from "lucide-react";

export default function AdminHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your students, exams, and token usage at a glance.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming in the analytics milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyMedia variant="icon">
              <SparklesIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Full dashboard loading…</EmptyTitle>
              <EmptyDescription>
                Charts and metrics land here. Meanwhile, add students and
                generate your first exam.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
