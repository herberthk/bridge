"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  BanknoteIcon,
  BookOpenCheckIcon,
  Building2Icon,
  FileClockIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  LineChartIcon,
  LogOutIcon,
  MicIcon,
  MoonIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SunIcon,
  UserRoundPlusIcon,
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
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ROLE_LABELS, type Role } from "@/lib/constants";

export interface ShellUser {
  name: string;
  email: string;
  role: Role;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV: Record<Role, { groups: { label: string; items: NavItem[] }[] }> = {
  admin: {
    groups: [
      {
        label: "Teach",
        items: [
          { href: "/admin", label: "Dashboard", icon: LayoutDashboardIcon },
          { href: "/admin/students", label: "Students", icon: UserRoundPlusIcon },
          { href: "/admin/generate", label: "Generate Exam", icon: SparklesIcon },
          { href: "/admin/exams", label: "Exam Library", icon: BookOpenCheckIcon },
          { href: "/admin/requests", label: "Retake Requests", icon: FileClockIcon },
          { href: "/admin/voice", label: "Voice Builder", icon: MicIcon },
        ],
      },
      {
        label: "Account",
        items: [{ href: "/admin/wallet", label: "Wallet & Usage", icon: WalletIcon }],
      },
    ],
  },
  student: {
    groups: [
      {
        label: "Learn",
        items: [
          { href: "/student", label: "Dashboard", icon: LayoutDashboardIcon },
          { href: "/student/exams", label: "My Exams", icon: FileClockIcon },
          { href: "/student/results", label: "Results", icon: LineChartIcon },
        ],
      },
    ],
  },
  super_admin: {
    groups: [
      {
        label: "Platform",
        items: [
          { href: "/super", label: "Overview", icon: LayoutDashboardIcon },
          { href: "/super/schools", label: "Schools & Admins", icon: Building2Icon },
          { href: "/super/wallets", label: "Wallets & Billing", icon: BanknoteIcon },
          { href: "/super/audit", label: "Audit Log", icon: ScrollTextIcon },
        ],
      },
    ],
  },
};

function BrandMark() {
  return (
    <span className="bg-brand shadow-glow flex size-8 shrink-0 items-center justify-center rounded-xl text-primary-foreground">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="size-4.5"
        aria-hidden
      >
        <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
        <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
        <path d="M6 4v2M12 4v2M18 4v2" />
      </svg>
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <SunIcon className="dark:hidden" />
      <MoonIcon className="hidden dark:block" />
    </Button>
  );
}

/** Authenticated app chrome: brand sidebar (role-aware nav) + content area. */
export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const groups = NAV[user.role].groups;

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" render={<Link href="/" />}>
                <BrandMark />
                <div className="flex flex-col leading-none">
                  <span className="font-semibold">Bridge</span>
                  <span className="text-xs text-muted-foreground">
                    {ROLE_LABELS[user.role]}
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          {groups.map((group) => (
            <SidebarGroup key={group.label}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const isRoleRoot = item.href === `/${user.role}` || item.href === "/super";
                    const active = isRoleRoot
                      ? pathname === item.href
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          isActive={active}
                          tooltip={item.label}
                          render={<Link href={item.href} />}
                        >
                          <item.icon className="size-4" />
                          <span>{item.label}</span>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter>
          <div className="flex items-center gap-2 px-2 pb-2 group-data-[collapsible=icon]:hidden">
            <span className="bg-brand-soft flex size-8 shrink-0 items-center justify-center rounded-full text-accent-foreground">
              {user.role === "student" ? (
                <GraduationCapIcon className="size-4" />
              ) : (
                <ShieldCheckIcon className="size-4" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            </div>
            <ThemeToggle />
          </div>
          <Separator className="group-data-[collapsible=icon]:hidden" />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                tooltip="Sign out"
                onClick={() => void logout()}
              >
                <LogOutIcon className="size-4" />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-3 px-4 sm:px-6">
          <SidebarTrigger />
          <Badge variant="secondary" className="bg-brand-soft hidden sm:inline-flex">
            {ROLE_LABELS[user.role]}
          </Badge>
          <div className="flex-1" />
          <ThemeToggle />
          <Button variant="ghost" size="sm" render={<Link href="/" />}>
            Home
          </Button>
        </header>
        <div className="flex-1 p-4 sm:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
