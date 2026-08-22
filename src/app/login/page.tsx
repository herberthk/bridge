import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/features/auth/auth-shell";
import { LoginForm } from "@/components/features/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to take exams, manage students, or run your school on Bridge."
      footer={
        <p className="text-muted-foreground text-sm">
          Don&apos;t have an account? Ask your administrator to invite you, or{" "}
          <Link href="/setup" className="text-foreground font-medium hover:underline">
            run platform setup
          </Link>
          .
        </p>
      }
    >
      <LoginForm nextPath={nextPath} />
    </AuthShell>
  );
}
