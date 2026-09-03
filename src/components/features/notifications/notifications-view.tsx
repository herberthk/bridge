"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  BellIcon,
  BookOpenCheckIcon,
  CheckCheckIcon,
  ClipboardCheckIcon,
  FileClockIcon,
  Loader2Icon,
  RotateCcwIcon,
  TrophyIcon,
  XCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/firebase/client";
import {
  fetchOlderNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  subscribeRecentNotifications,
} from "@/lib/firebase/notifications";
import type { NotificationDoc, NotificationType } from "@/types/firestore";
import type { WithId } from "@/types/firestore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const PAGE_SIZE = 20;

const TYPE_META: Record<NotificationType, { icon: typeof BellIcon; tone: string; label: string }> = {
  exam_assigned: { icon: BookOpenCheckIcon, tone: "text-indigo-500 bg-indigo-500/10", label: "Exam assigned" },
  retake_approved: { icon: CheckCheckIcon, tone: "text-emerald-500 bg-emerald-500/10", label: "Retake approved" },
  retake_rejected: { icon: XCircleIcon, tone: "text-rose-500 bg-rose-500/10", label: "Retake declined" },
  results_ready: { icon: TrophyIcon, tone: "text-amber-500 bg-amber-500/10", label: "Results ready" },
  exam_submitted: { icon: ClipboardCheckIcon, tone: "text-teal-500 bg-teal-500/10", label: "Exam submitted" },
  retake_requested: { icon: FileClockIcon, tone: "text-violet-500 bg-violet-500/10", label: "Retake requested" },
};

/** Full notifications page: live recent list + paginated history. */
export function NotificationsView() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [recent, setRecent] = useState<WithId<NotificationDoc>[]>([]);
  const [older, setOlder] = useState<WithId<NotificationDoc>[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    const user = authClient().currentUser;
    if (!user) return;
    setUid(user.uid);
    return subscribeRecentNotifications(user.uid, PAGE_SIZE, setRecent);
  }, []);

  const items = useMemo<WithId<NotificationDoc>[]>(() => {
    const seen = new Set(recent.map((r) => r.id));
    return [...recent, ...older.filter((o) => !seen.has(o.id))];
  }, [recent, older]);

  const unreadCount = items.filter((i) => !i.read).length;

  const loadMore = useCallback(async () => {
    if (!uid || loadingMore) return;
    setLoadingMore(true);
    try {
      const last = items.at(-1);
      const cursor = last?.createdAt as unknown as string | undefined;
      if (!cursor) {
        setExhausted(true);
        return;
      }
      const page = await fetchOlderNotifications(uid, cursor, PAGE_SIZE);
      setOlder((prev) => [...prev, ...page]);
      if (page.length < PAGE_SIZE) setExhausted(true);
    } catch {
      toast.error("Could not load older notifications.");
    } finally {
      setLoadingMore(false);
    }
  }, [uid, items, loadingMore]);

  const open = (item: WithId<NotificationDoc>) => {
    if (!item.read) void markNotificationRead(item.id);
    router.push(item.link);
  };

  const markAll = async () => {
    if (!uid) return;
    await markAllNotificationsRead(uid);
    toast.success("All notifications marked as read.");
  };

  const hasUnread = unreadCount > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BellIcon className="text-primary size-6" />
            Notifications
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {hasUnread
              ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`
              : "You're all caught up."}
          </p>
        </div>
        {hasUnread && (
          <Button variant="outline" onClick={() => void markAll()}>
            <CheckCheckIcon data-icon="inline-start" />
            Mark all as read
          </Button>
        )}
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>Recent</CardTitle>
          <CardDescription>
            New notifications appear here instantly — click one to open it.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-12 text-center text-sm">
              <BellIcon className="text-muted-foreground/40 size-8" />
              Nothing here yet.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const meta = TYPE_META[item.type as NotificationType] ?? TYPE_META.exam_assigned;
                const Icon = meta.icon;
                const created = item.createdAt as unknown as string | null;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => open(item)}
                      className={cn(
                        "hover:bg-accent/60 flex w-full items-start gap-3 px-6 py-4 text-left transition-colors",
                        !item.read && "bg-primary/5",
                      )}
                    >
                      <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", meta.tone)}>
                        <Icon className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate text-sm", !item.read ? "font-semibold" : "font-medium")}>
                            {item.title}
                          </span>
                          <span className="text-muted-foreground/70 shrink-0 text-[10px]">
                            {created ? formatDistanceToNow(new Date(created), { addSuffix: true }) : ""}
                          </span>
                          {!item.read && <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                        </span>
                        <span className="text-muted-foreground mt-0.5 block text-xs">{item.body}</span>
                        <span className="text-muted-foreground/60 mt-1 block text-[10px] font-medium tracking-wide uppercase">
                          {meta.label}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {!exhausted && items.length > 0 && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? (
              <>
                <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
                Loading…
              </>
            ) : (
              "Load older notifications"
            )}
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-center text-xs">
        Need something else? Head back to your{" "}
        <Link href="/" className="text-primary underline">
          dashboard
        </Link>
        .
      </p>
    </div>
  );
}
