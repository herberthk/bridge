import { AppShell } from "@/components/app-shell/app-shell";
import { requireRole } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireRole("admin");
  return (
    <AppShell user={{ name: user.displayName, email: user.email ?? "", role: user.role }}>
      {children}
    </AppShell>
  );
}
