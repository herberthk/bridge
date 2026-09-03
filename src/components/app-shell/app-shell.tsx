"use client";

import React, { memo, useCallback, useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BanknoteIcon,
  BookOpenCheckIcon,
  Building2Icon,
  ChevronRightIcon,
  ChevronsUpDownIcon,
  FileClockIcon,
  GraduationCapIcon,
  HomeIcon,
  LaptopIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  Loader2Icon,
  LogOutIcon,
  MicIcon,
  MoonIcon,
  ScrollTextIcon,
  SchoolIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  UserRoundIcon,
  UserRoundPlusIcon,
  UsersRoundIcon,
  WalletIcon,
} from "lucide-react";

import { logout } from "@/components/auth-sync";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ROLE_LABELS, type Role } from "@/lib/constants";
import { NotificationsBell } from "@/components/features/notifications/notifications-bell";
import { cn } from "@/lib/utils";

export interface ShellUser {
  name: string;
  email: string;
  role: Role;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: {
    text: string;
    variant?: "default" | "brand" | "teal" | "amber";
  };
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_CONFIG: Record<Role, { groups: NavGroup[] }> = {
  admin: {
    groups: [
      {
        label: "School",
        items: [
          { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
          { href: "/admin/classes", label: "Classes", icon: SchoolIcon },
          { href: "/admin/teachers", label: "Teachers", icon: UsersRoundIcon },
          { href: "/admin/school", label: "School Profile", icon: Building2Icon },
        ],
      },
      {
        label: "Management & Teaching",
        items: [
          { href: "/admin/students", label: "Students", icon: UserRoundPlusIcon },
          {
            href: "/admin/generate",
            label: "Generate Exam",
            icon: SparklesIcon,
            badge: { text: "AI", variant: "brand" },
          },
          { href: "/admin/exams", label: "Exam Library", icon: BookOpenCheckIcon },
          { href: "/admin/requests", label: "Retake Requests", icon: FileClockIcon },
          {
            href: "/admin/voice",
            label: "Voice Builder",
            icon: MicIcon,
            badge: { text: "Live", variant: "teal" },
          },
        ],
      },
      {
        label: "Billing & Account",
        items: [
          {
            href: "/admin/wallet",
            label: "Wallet & Usage",
            icon: WalletIcon,
          },
        ],
      },
    ],
  },
  teacher: {
    groups: [
      {
        label: "Teaching",
        items: [
          { href: "/teacher", label: "Dashboard", icon: LayoutDashboardIcon },
          { href: "/teacher/classes", label: "My Classes", icon: SchoolIcon },
          { href: "/teacher/students", label: "Students", icon: UserRoundPlusIcon },
          {
            href: "/teacher/generate",
            label: "Generate Exam",
            icon: SparklesIcon,
            badge: { text: "AI", variant: "brand" },
          },
          { href: "/teacher/exams", label: "Exam Library", icon: BookOpenCheckIcon },
          { href: "/teacher/requests", label: "Retake Requests", icon: FileClockIcon },
        ],
      },
      {
        label: "Billing & Account",
        items: [
          {
            href: "/teacher/wallet",
            label: "Wallet & Usage",
            icon: WalletIcon,
          },
        ],
      },
    ],
  },
  member: {
    groups: [
      {
        label: "Getting Started",
        items: [
          { href: "/onboarding", label: "Set Up Your School", icon: Building2Icon },
        ],
      },
    ],
  },
  student: {
    groups: [
      {
        label: "Learning Space",
        items: [
          { href: "/student", label: "Dashboard", icon: LayoutDashboardIcon },
          { href: "/student/exams", label: "My Exams", icon: FileClockIcon },
          { href: "/student/results", label: "Performance & Results", icon: LineChartIcon },
        ],
      },
    ],
  },
  super_admin: {
    groups: [
      {
        label: "Platform Administration",
        items: [
          { href: "/super", label: "Overview", icon: LayoutDashboardIcon },
          { href: "/super/schools", label: "Schools", icon: Building2Icon },
          { href: "/super/students", label: "Students", icon: UserRoundPlusIcon },
          { href: "/super/teachers", label: "Teachers", icon: UsersRoundIcon },
          {
            href: "/super/wallets",
            label: "Wallets & Billing",
            icon: BanknoteIcon,
          },
          { href: "/super/audit", label: "Audit Logs", icon: ScrollTextIcon },
        ],
      },
    ],
  },
};

/** Deterministic gradient and text color for luxury user avatar fallback. */
function getAvatarGradient(name: string): string {
  const gradients = [
    "from-indigo-600 to-violet-600 text-white",
    "from-violet-600 to-fuchsia-600 text-white",
    "from-blue-600 to-cyan-600 text-white",
    "from-emerald-600 to-teal-600 text-white",
    "from-rose-600 to-pink-600 text-white",
    "from-amber-600 to-orange-600 text-white",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % gradients.length;
  return gradients[index];
}

/** Extract user initials (max 2 characters). */
function getInitials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Luxury Brand Mark with shimmering gradient & backdrop glow. */
const BrandMark = memo(function BrandMark() {
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-indigo-500 via-purple-600 to-pink-500 shadow-md shadow-indigo-500/20 ring-1 ring-white/25 transition-transform duration-300 group-hover/brand:scale-105">
      <div className="absolute inset-0 rounded-xl bg-white/10 opacity-0 transition-opacity duration-300 group-hover/brand:opacity-100" />
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-5 text-white drop-shadow-xs"
        aria-hidden
      >
        <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
        <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
        <path d="M6 4v2M12 4v2M18 4v2" />
      </svg>
    </div>
  );
});

/** Hydration-safe Theme Toggle with smooth icon transitions. */
export function ThemeToggle({
  className,
  variant = "ghost",
}: {
  className?: string;
  variant?: "ghost" | "outline";
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  if (!mounted) {
    return (
      <Button
        variant={variant}
        size="icon-sm"
        aria-label="Toggle theme"
        className={cn("size-8 rounded-lg text-muted-foreground", className)}
      >
        <SunIcon className="size-4" />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size="icon-sm"
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            onClick={toggleTheme}
            className={cn(
              "relative size-8 rounded-lg transition-colors hover:bg-accent/80 hover:text-foreground",
              className
            )}
          />
        }
      >
        <SunIcon
          className={cn(
            "size-4 transition-all duration-300",
            isDark ? "rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100"
          )}
        />
        <MoonIcon
          className={cn(
            "absolute size-4 transition-all duration-300",
            isDark ? "rotate-0 scale-100 opacity-100" : "-rotate-90 scale-0 opacity-0"
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center">
        {isDark ? "Light mode" : "Dark mode"}
      </TooltipContent>
    </Tooltip>
  );
}

/** Breadcrumbs dynamically derived from the current pathname. */
const DynamicBreadcrumbs = memo(function DynamicBreadcrumbs({
  pathname,
  role,
}: {
  pathname: string;
  role: Role;
}) {
  const breadcrumbItems = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length === 0) return [];

    const items: { label: string; href: string; isLast: boolean }[] = [];
    let accumulatedPath = "";

    const segmentTitles: Record<string, string> = {
      admin: "School Admin",
      teacher: "Teacher",
      student: "Student",
      super: "Super Admin",
      classes: "Classes",
      teachers: "Teachers",
      school: "School Profile",
      leaderboard: "Leaderboard",
      students: "Students",
      generate: "Generate Exam",
      exams: "Exam Library",
      requests: "Retake Requests",
      voice: "Voice Builder",
      wallet: "Wallet & Usage",
      results: "Results & Analytics",
      schools: "Schools & Admins",
      wallets: "Wallets & Billing",
      audit: "Audit Logs",
      onboarding: "Onboarding",
      exam: "Exam Session",
    };

    segments.forEach((seg, idx) => {
      accumulatedPath += `/${seg}`;
      const isLast = idx === segments.length - 1;
      const label =
        segmentTitles[seg] ||
        seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, " ");

      items.push({
        label,
        href: accumulatedPath,
        isLast,
      });
    });

    return items;
  }, [pathname]);

  if (breadcrumbItems.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-foreground">Bridge</span>
        <span className="text-muted-foreground/50">/</span>
        <span className="text-muted-foreground">{ROLE_LABELS[role]}</span>
      </div>
    );
  }

  return (
    <Breadcrumb className="hidden sm:flex">
      <BreadcrumbList className="text-xs sm:text-sm">
          <BreadcrumbItem>
            <BreadcrumbLink
              render={<Link href={role === "super_admin" ? "/super" : role === "member" ? "/onboarding" : `/${role}`} />}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
            <HomeIcon className="size-3.5" />
            <span className="sr-only">Home</span>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {breadcrumbItems.map((item) => (
          <React.Fragment key={item.href}>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {item.isLast ? (
                <BreadcrumbPage className="font-semibold text-foreground">
                  {item.label}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  render={<Link href={item.href} />}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {item.label}
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
});

/** Navigation Item with custom badge, glowing active indicator, and smooth hover. */
interface NavItemProps {
  item: NavItem;
  isActive: boolean;
}

const SidebarNavItem = memo(function SidebarNavItem({
  item,
  isActive,
}: NavItemProps) {
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.label}
        render={<Link href={item.href} />}
        className={cn(
          "group/nav-btn relative flex h-9.5 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-all duration-150",
          isActive
            ? "bg-primary/10 font-semibold text-primary shadow-xs dark:bg-primary/15 dark:text-primary-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground"
        )}
      >
        {isActive && (
          <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary shadow-[0_0_10px_var(--primary)]" />
        )}
        <Icon
          className={cn(
            "size-4 shrink-0 transition-transform duration-200 group-hover/nav-btn:scale-110",
            isActive ? "text-primary dark:text-primary-foreground" : "text-muted-foreground/80 group-hover/nav-btn:text-foreground"
          )}
        />
        <span className="truncate">{item.label}</span>
        {item.badge && (
          <Badge
            variant="secondary"
            className={cn(
              "ml-auto text-[10px] font-bold tracking-wide uppercase px-1.5 py-0 h-4.5 group-data-[collapsible=icon]:hidden",
              item.badge.variant === "brand" &&
                "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25",
              item.badge.variant === "teal" &&
                "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/25",
              item.badge.variant === "amber" &&
                "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25"
            )}
          >
            {item.badge.text}
          </Badge>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
});

/** Interactive User Profile Menu for Footer with Dropdown & Collapsed Support. */
interface UserAccountMenuProps {
  user: ShellUser;
  onLogout: () => Promise<void>;
  isLoggingOut: boolean;
}

const UserAccountMenu = memo(function UserAccountMenu({
  user,
  onLogout,
  isLoggingOut,
}: UserAccountMenuProps) {
  const { state, isMobile } = useSidebar();
  const isCollapsed = state === "collapsed" && !isMobile;
  const { resolvedTheme, setTheme } = useTheme();
  const avatarGradient = useMemo(() => getAvatarGradient(user.name), [user.name]);
  const initials = useMemo(() => getInitials(user.name), [user.name]);

  const roleThemeBadge = useMemo(() => {
    switch (user.role) {
      case "student":
        return {
          label: "Student",
          color: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
          icon: GraduationCapIcon,
        };
      case "teacher":
        return {
          label: "Teacher",
          color: "bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/20",
          icon: UserRoundIcon,
        };
      case "member":
        return {
          label: "Member",
          color: "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/20",
          icon: UserRoundIcon,
        };
      case "super_admin":
        return {
          label: "Super Admin",
          color: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/20",
          icon: ShieldAlertIcon,
        };
      default:
        return {
          label: "School Admin",
          color: "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
          icon: ShieldCheckIcon,
        };
    }
  }, [user.role]);

  const RoleIcon = roleThemeBadge.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "group/user flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-all duration-150 outline-none select-none",
              "hover:bg-sidebar-accent/80 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isCollapsed && "justify-center p-1.5"
            )}
          />
        }
      >
        <div className="relative">
          <Avatar size="default" className="size-8.5 ring-1.5 ring-background shadow-xs">
            <AvatarFallback
              className={cn(
                "bg-linear-to-br font-semibold text-xs transition-transform duration-200 group-hover/user:scale-105",
                avatarGradient
              )}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-sidebar" />
        </div>

        {!isCollapsed && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold text-foreground">
                {user.name}
              </span>
            </div>
            <span className="truncate text-xs text-muted-foreground">
              {user.email}
            </span>
          </div>
        )}

        {!isCollapsed && (
          <ChevronsUpDownIcon className="size-4 shrink-0 text-muted-foreground/70 transition-transform duration-200 group-hover/user:text-foreground" />
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align={isCollapsed ? "start" : "end"}
        side={isCollapsed ? "right" : "top"}
        sideOffset={8}
        className="w-64 rounded-xl border border-border/80 bg-popover/95 p-1.5 shadow-xl backdrop-blur-lg"
      >
        <DropdownMenuLabel className="p-2 font-normal">
          <div className="flex items-center gap-3">
            <Avatar size="lg" className="size-10 ring-1 ring-border">
              <AvatarFallback className={cn("bg-linear-to-br font-semibold text-sm", avatarGradient)}>
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="truncate text-sm font-semibold text-foreground">{user.name}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
              <div className="mt-1 flex items-center gap-1">
                <Badge
                  variant="outline"
                  className={cn("h-4.5 gap-1 px-1.5 text-[10px] font-medium", roleThemeBadge.color)}
                >
                  <RoleIcon className="size-3" />
                  {roleThemeBadge.label}
                </Badge>
              </div>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuGroup>
          {(user.role === "admin" || user.role === "teacher") && (
            <DropdownMenuItem render={<Link href={`/${user.role}/wallet`} />}>
              <WalletIcon className="size-4 text-muted-foreground" />
              <span>Wallet & Usage</span>
            </DropdownMenuItem>
          )}
          {user.role === "student" && (
            <DropdownMenuItem render={<Link href="/student/results" />}>
              <LineChartIcon className="size-4 text-muted-foreground" />
              <span>My Results</span>
            </DropdownMenuItem>
          )}
          {user.role === "super_admin" && (
            <DropdownMenuItem render={<Link href="/super/audit" />}>
              <ScrollTextIcon className="size-4 text-muted-foreground" />
              <span>System Audit Logs</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          Appearance
        </DropdownMenuLabel>
        <div className="grid grid-cols-3 gap-1 px-1 py-1">
          <Button
            type="button"
            variant={resolvedTheme === "light" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTheme("light")}
            className="h-7 text-xs justify-center gap-1"
          >
            <SunIcon className="size-3.5" />
            Light
          </Button>
          <Button
            type="button"
            variant={resolvedTheme === "dark" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTheme("dark")}
            className="h-7 text-xs justify-center gap-1"
          >
            <MoonIcon className="size-3.5" />
            Dark
          </Button>
          <Button
            type="button"
            variant={resolvedTheme === "system" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setTheme("system")}
            className="h-7 text-xs justify-center gap-1"
          >
            <LaptopIcon className="size-3.5" />
            Auto
          </Button>
        </div>

        <DropdownMenuSeparator className="my-1" />

        <DropdownMenuItem
          variant="destructive"
          disabled={isLoggingOut}
          onClick={() => void onLogout()}
          className="text-destructive focus:bg-destructive/10 focus:text-destructive cursor-pointer font-medium"
        >
          {isLoggingOut ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <LogOutIcon className="size-4" />
          )}
          <span>{isLoggingOut ? "Signing out…" : "Sign out"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

/**
 * AppShell: State-of-the-Art Authenticated Application Chrome.
 * Features:
 * - Luxury brand header with collapsible micro-interactions
 * - Grouped, role-aware navigation with glowing active pills
 * - Dynamic path breadcrumbs with smooth routing links
 * - Rich User Account profile footer with theme switcher & clean sign out
 * - Performance optimized with React.memo & memoized active route matching
 */
export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const groups = useMemo(() => NAV_CONFIG[user.role]?.groups ?? [], [user.role]);

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) return;
    try {
      setIsLoggingOut(true);
      await logout();
      router.push("/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, router]);

  const checkIsActive = useCallback(
    (href: string) => {
      const isRoleRoot = href === `/${user.role}` || href === "/super";
      return isRoleRoot
        ? pathname === href
        : pathname === href || pathname.startsWith(`${href}/`);
    },
    [pathname, user.role]
  );

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border/60 bg-sidebar/95 backdrop-blur-md">
        {/* Brand Header */}
        <SidebarHeader className="border-b border-sidebar-border/50 p-3">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                render={<Link href={user.role === "super_admin" ? "/super" : user.role === "member" ? "/onboarding" : `/${user.role}`} />}
                className="group/brand flex h-11 items-center gap-3 rounded-xl px-2 transition-colors hover:bg-sidebar-accent/60"
              >
                <BrandMark />
                <div className="flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold tracking-tight text-base bg-linear-to-r from-foreground via-foreground to-foreground/75 bg-clip-text text-transparent">
                      Bridge
                    </span>
                  </div>
                  <span className="text-[11px] font-medium text-muted-foreground/80">
                    {ROLE_LABELS[user.role]}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        {/* Navigation Content */}
        <SidebarContent className="px-2 py-3 space-y-4">
          {groups.map((group) => (
            <SidebarGroup key={group.label} className="p-0">
              <SidebarGroupLabel className="px-3 text-[11px] font-semibold tracking-wider text-muted-foreground/70 uppercase">
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent className="mt-1">
                <SidebarMenu className="gap-1">
                  {group.items.map((item) => (
                    <SidebarNavItem
                      key={item.href}
                      item={item}
                      isActive={checkIsActive(item.href)}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        {/* Footer User Card */}
        <SidebarFooter className="border-t border-sidebar-border/50 p-2">
          <UserAccountMenu
            user={user}
            onLogout={handleLogout}
            isLoggingOut={isLoggingOut}
          />
        </SidebarFooter>

        <SidebarRail />
      </Sidebar>

      {/* Main Content View with Top Bar */}
      <SidebarInset className="bg-background">
        <header className="glass sticky top-0 z-30 flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6 shadow-xs">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="hover:bg-accent/80 hover:text-foreground" />
            <div className="h-4 w-px bg-border/60 hidden sm:block" />
            <DynamicBreadcrumbs pathname={pathname} role={user.role} />
          </div>

          <div className="flex items-center gap-2">
            {(user.role === "student" || user.role === "admin" || user.role === "teacher") && (
              <NotificationsBell />
            )}
            <Badge
              variant="outline"
              className="hidden md:inline-flex bg-accent/40 text-muted-foreground border-border/60 text-xs px-2 py-0.5 font-medium"
            >
              {ROLE_LABELS[user.role]}
            </Badge>

            <ThemeToggle />

            <Button
              variant="ghost"
              size="sm"
              render={<Link href="/" />}
              className="hidden sm:inline-flex text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Home
            </Button>
          </div>
        </header>

        <div className="flex-1 p-4 sm:p-6 lg:p-8 animate-in fade-in-50 duration-200">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
