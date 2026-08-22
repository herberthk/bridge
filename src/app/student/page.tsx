export const dynamic = "force-dynamic";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { FileClockIcon } from "lucide-react";

export default function StudentHomePage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your upcoming exams, recent scores, and feedback.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Coming in the analytics milestone</CardTitle>
        </CardHeader>
        <CardContent>
          <Empty>
            <EmptyMedia variant="icon">
              <FileClockIcon />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No exams yet</EmptyTitle>
              <EmptyDescription>
                When your teacher assigns an exam, it will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </div>
  );
}
