"use client";

import { memo, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  BellIcon,
  BellRingIcon,
  BookOpenCheckIcon,
  CheckCheckIcon,
  ClipboardCheckIcon,
  FileClockIcon,
  TrophyIcon,
  XCircleIcon,
} from "lucide-react";

import { authClient } from "@/lib/firebase/client";
import {
  markAllNotificationsRead,
  markNotificationRead,
  subscribeRecentNotifications,
  subscribeUnreadCount,
  type NotificationItem,
  type UnreadBadge,
} from "@/lib/firebase/notifications";
import type { NotificationType } from "@/types/firestore";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Live notification bell for the app shell. Subscribes to the signed-in
 * user's notifications via Firestore snapshots — unread badge updates in
 * real time without polling.
 */

const TYPE_META: Record<NotificationType, { icon: typeof BellIcon; tone: string }> = {
  exam_assigned: { icon: BookOpenCheckIcon, tone: "text-indigo-500 bg-indigo-500/10" },
  retake_approved: { icon: CheckCheckIcon, tone: "text-emerald-500 bg-emerald-500/10" },
  retake_rejected: { icon: XCircleIcon, tone: "text-rose-500 bg-rose-500/10" },
  results_ready: { icon: TrophyIcon, tone: "text-amber-500 bg-amber-500/10" },
  exam_submitted: { icon: ClipboardCheckIcon, tone: "text-teal-500 bg-teal-500/10" },
  retake_requested: { icon: FileClockIcon, tone: "text-violet-500 bg-violet-500/10" },
};

function timeAgo(date: Date | null): string {
  if (!date) return "";
  const ms = Date.now() - date.getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const NotificationsBell = memo(function NotificationsBell() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [badge, setBadge] = useState<UnreadBadge>({ count: 0, capped: false });
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let unsubBadge: (() => void) | null = null;
    let unsubList: (() => void) | null = null;
    const unsubAuth = onAuthStateChanged(authClient(), (user) => {
      unsubBadge?.();
      unsubList?.();
      unsubBadge = null;
      unsubList = null;
      setUid(user?.uid ?? null);
      if (!user) {
        setBadge({ count: 0, capped: false });
        setItems([]);
        return;
      }
      unsubBadge = subscribeUnreadCount(user.uid, setBadge);
      unsubList = subscribeRecentNotifications(user.uid, 12, setItems);
    });
    return () => {
      unsubAuth();
      unsubBadge?.();
      unsubList?.();
    };
  }, []);

  const openItem = async (item: NotificationItem) => {
    setOpen(false);
    if (!item.read) {
      void markNotificationRead(item.id).catch((err) => {
        console.error("[notifications] could not mark notification read", err);
      });
    }
    router.push(item.link);
  };

  const markAll = async () => {
    if (!uid) return;
    await markAllNotificationsRead(uid).catch((err) => {
      console.error("[notifications] could not mark all notifications read", err);
    });
  };

  const hasUnread = badge.count > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              hasUnread ? `${badge.count} unread notifications` : "Notifications"
            }
            className="relative size-8 rounded-lg text-muted-foreground hover:text-foreground"
          />
        }
      >
        {hasUnread ? (
          <BellRingIcon className="size-4 text-primary" />
        ) : (
          <BellIcon className="size-4" />
        )}
        {hasUnread && (
          <span className="bg-rose-500 text-white absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-4 ring-2 ring-background">
            {badge.capped ? "25+" : badge.count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          {hasUnread && (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void markAll()}>
              <CheckCheckIcon data-icon="inline-start" className="size-3.5" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          {items.length === 0 ? (
            <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-center text-sm">
              <BellIcon className="text-muted-foreground/40 size-8" />
              Nothing yet — notifications about your exams will appear here.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((item) => {
                const meta = TYPE_META[item.type as NotificationType] ?? TYPE_META.exam_assigned;
                const Icon = meta.icon;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => void openItem(item)}
                      className={cn(
                        "hover:bg-accent/60 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                        !item.read && "bg-primary/5",
                      )}
                    >
                      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", meta.tone)}>
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className={cn("truncate text-sm font-medium", !item.read && "font-semibold")}>
                            {item.title}
                          </span>
                          {!item.read && <span className="bg-primary size-1.5 shrink-0 rounded-full" />}
                        </span>
                        <span className="text-muted-foreground line-clamp-2 block text-xs">{item.body}</span>
                        <span className="text-muted-foreground/70 mt-0.5 block text-[10px]">
                          {timeAgo(item.createdAt.toDate())}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            render={<Link href="/notifications" />}
            onClick={() => setOpen(false)}
          >
            View all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
});
