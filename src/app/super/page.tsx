export const dynamic = "force-dynamic";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { LineChartIcon } from "lucide-react";

export default function SuperHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Platform overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Exams taken, revenue trends, active users, and schools.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming in the analytics milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyMedia variant="icon">
              <LineChartIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>Platform metrics loading…</EmptyTitle>
              <EmptyDescription>
                Create schools and admins to get started — the analytics
                dashboard lands here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
