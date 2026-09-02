"use client";

import { TrendingDownIcon, TrendingUpIcon, TrophyIcon, MinusIcon } from "lucide-react";

import type { LeaderboardEntry, ClassPerformanceStats } from "@/lib/leaderboard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AnimatedCounter } from "@/components/motion";

const MEDALS = ["🥇", "🥈", "🥉"] as const;

function rankStyle(rank: number | null): string {
  if (rank === 1) return "bg-amber-500/10 font-semibold";
  if (rank === 2) return "bg-slate-500/5 font-semibold";
  if (rank === 3) return "bg-orange-500/5 font-medium";
  return "";
}

function Trend({ value }: { value: number | null }) {
  if (value === null || value === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <MinusIcon className="size-3" /> —
      </span>
    );
  }
  const up = value > 0;
  return (
    <span
      className={
        up
          ? "inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400"
          : "inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400"
      }
    >
      {up ? <TrendingUpIcon className="size-3" /> : <TrendingDownIcon className="size-3" />}
      {up ? "+" : ""}
      {value}%
    </span>
  );
}

/** Class leaderboard — ranked by mean score across graded attempts. */
export function LeaderboardView({
  entries,
  stats,
  className,
}: {
  entries: LeaderboardEntry[];
  stats: ClassPerformanceStats;
  className?: string;
}) {
  const ranked = entries.filter((e) => e.rank !== null).length;

  return (
    <div className={className ?? "flex flex-col gap-6"}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Class average</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">
              {stats.averagePercentage === null ? (
                "—"
              ) : (
                <>
                  <AnimatedCounter value={stats.averagePercentage} />%
                </>
              )}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Top score</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">
              {stats.topPercentage === null ? "—" : `${stats.topPercentage}%`}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Participation</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">{stats.participationRate}%</p>
            <p className="text-muted-foreground text-xs">
              {stats.gradedAttempts} graded attempt{stats.gradedAttempts === 1 ? "" : "s"}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader className="pb-2">
            <CardDescription>Students ranked</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold tracking-tight">
              {ranked}
              <span className="text-muted-foreground text-base font-normal"> / {stats.students}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="overflow-hidden shadow-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrophyIcon className="size-4 text-amber-500" />
            Leaderboard
          </CardTitle>
          <CardDescription>
            Ranked by average score across graded attempts — best single score breaks ties.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-12 text-center text-sm">
              <TrophyIcon className="size-8 text-muted-foreground/40" />
              No students in this class yet — add students to start the race.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Rank</TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead className="text-right">Average</TableHead>
                  <TableHead className="text-right">Best</TableHead>
                  <TableHead className="text-right">Attempts</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  <TableHead className="text-right">Trend</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.studentId} className={rankStyle(entry.rank)}>
                    <TableCell>
                      {entry.rank === null ? (
                        <span className="text-muted-foreground text-sm">—</span>
                      ) : entry.rank <= 3 ? (
                        <span className="text-lg" aria-label={`Rank ${entry.rank}`}>
                          {MEDALS[entry.rank - 1]}
                        </span>
                      ) : (
                        <Badge variant="outline" className="font-mono">
                          #{entry.rank}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-48 truncate font-medium">
                      {entry.displayName}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.averagePercentage === null ? (
                        <span className="text-muted-foreground text-sm">No results yet</span>
                      ) : (
                        <span className="tabular-nums">{entry.averagePercentage}%</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.bestPercentage === null ? "—" : `${entry.bestPercentage}%`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{entry.attemptsTaken}</TableCell>
                    <TableCell className="text-muted-foreground text-right text-xs tabular-nums">
                      {entry.totalMarksEarned}/{entry.totalMarksPossible}
                    </TableCell>
                    <TableCell className="text-right">
                      <Trend value={entry.trend} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
