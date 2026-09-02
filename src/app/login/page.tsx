import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeftIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  GraduationCapIcon,
  LockIcon,
  ScanEyeIcon,
  ShieldCheckIcon,
  SparklesIcon,
  ZapIcon,
} from "lucide-react";

import { LoginForm } from "@/components/features/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — Bridge",
  description:
    "Sign in to your Bridge account to generate AI exams, manage proctoring, or assess student performance.",
  openGraph: {
    title: "Sign in to Bridge",
    description:
      "The AI-powered assessment, proctoring, and grading platform for modern schools.",
  },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const params = await searchParams;
  const nextPath = Array.isArray(params.next) ? params.next[0] : params.next;

  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-8 sm:px-6 lg:px-8">
      {/* Decorative ambient background glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 -left-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 -right-40 size-96 rounded-full bg-primary/15 blur-[120px] dark:bg-primary/20"
      />

      {/* Top utility bar */}
      <header className="relative z-10 mb-6 flex w-full max-w-5xl items-center justify-between">
        <Link
          href="/"
          className="group text-muted-foreground hover:text-foreground inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3.5 py-1.5 text-xs font-medium backdrop-blur-md transition-all hover:border-border hover:bg-card hover:shadow-xs"
        >
          <ArrowLeftIcon className="size-3.5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          <span>Back to home</span>
        </Link>

        <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/70 px-3 py-1 text-xs text-muted-foreground backdrop-blur-md">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-mono text-[11px] tracking-tight">System Operational</span>
        </div>
      </header>

      {/* Main card */}
      <main className="gradient-border shadow-lifted relative z-10 grid w-full max-w-5xl overflow-hidden rounded-3xl bg-card/95 backdrop-blur-xl md:grid-cols-12">
        {/* Left column: Brand & Feature Showcase */}
        <div className="bg-brand relative hidden flex-col justify-between p-8 text-primary-foreground md:col-span-5 md:flex lg:col-span-5 lg:p-10">
          {/* Subtle radial highlight inside brand panel */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(28rem 20rem at 0% 0%, rgba(255,255,255,0.6), transparent 70%), radial-gradient(24rem 18rem at 100% 100%, rgba(255,255,255,0.4), transparent 70%)",
            }}
          />

          {/* Brand header */}
          <div className="relative flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-white/20 shadow-inner backdrop-blur-md">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="size-5.5"
                  aria-hidden="true"
                >
                  <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
                  <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
                  <path d="M6 4v2M12 4v2M18 4v2" />
                </svg>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-xl font-bold tracking-tight">Bridge</span>
                <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase backdrop-blur-sm">
                  v2.5 AI
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight text-pretty text-white lg:text-3xl">
                Assessment that elevates the classroom.
              </h2>
              <p className="text-sm leading-relaxed text-white/80">
                Experience next-generation exam synthesis, intelligent proctoring, and instant rubric grading.
              </p>
            </div>
          </div>

          {/* Feature highlight list */}
          <div className="relative my-8 space-y-3.5">
            <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur-md transition-all hover:bg-white/15">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
                <BrainCircuitIcon className="size-4.5" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-white">AI-Powered Exam Engine</p>
                <p className="text-white/75">Generate balanced questions tailored to curriculum levels in seconds.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur-md transition-all hover:bg-white/15">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
                <ScanEyeIcon className="size-4.5" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-white">Smart Fair Proctoring</p>
                <p className="text-white/75">Continuous integrity checks with two-strike student grace policy.</p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-2xl bg-white/10 p-3.5 backdrop-blur-md transition-all hover:bg-white/15">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/20 text-white">
                <ZapIcon className="size-4.5" />
              </div>
              <div className="text-xs">
                <p className="font-semibold text-white">Instant Rubric Grading</p>
                <p className="text-white/75">Instant auto-scoring with personalized student feedback summaries.</p>
              </div>
            </div>
          </div>

          {/* Brand footer */}
          <div className="relative flex flex-col gap-3 border-t border-white/15 pt-4">
            <div className="flex items-center gap-2 text-xs text-white/80">
              <GraduationCapIcon className="size-4 shrink-0 text-white" />
              <span>Aligned with Ugandan UNEB &amp; NCDC standards</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/80">
              <ShieldCheckIcon className="size-4 shrink-0 text-white" />
              <span>End-to-end encrypted session security</span>
            </div>
          </div>
        </div>

        {/* Right column: Login Form Panel */}
        <div className="flex flex-col justify-between p-6 sm:p-8 md:col-span-7 md:p-10 lg:col-span-7 lg:p-12">
          {/* Header */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <SparklesIcon className="size-3.5" />
                <span>Institutional Portal</span>
              </div>
              <span className="text-muted-foreground text-xs">Bridge Web v2.5</span>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Welcome back
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Sign in to take scheduled exams, manage your students, or administer your institution.
            </p>
          </div>

          {/* Form */}
          <div className="my-6">
            <LoginForm nextPath={nextPath} />
          </div>

          {/* Footer & Meta Links */}
          <div className="flex flex-col gap-4 border-t border-border/70 pt-5 text-center sm:text-left">
            <div className="text-muted-foreground flex flex-col gap-1 text-xs sm:flex-row sm:items-center sm:justify-between">
              <p>
                New to Bridge?{" "}
                <Link
                  href="/signup"
                  className="text-foreground hover:text-primary font-semibold underline underline-offset-4 transition-colors"
                >
                  Create your school&apos;s account
                </Link>
              </p>
              <span className="text-muted-foreground/60 hidden sm:inline">•</span>
              <p>
                Need an institutional account?{" "}
                <Link
                  href="/setup"
                  className="text-foreground hover:text-primary font-semibold underline underline-offset-4 transition-colors"
                >
                  Platform setup
                </Link>
              </p>
            </div>

            <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground/80 sm:justify-start">
              <span className="inline-flex items-center gap-1">
                <LockIcon className="size-3" />
                256-bit SSL Encrypted
              </span>
              <span>•</span>
              <span className="inline-flex items-center gap-1">
                <CheckCircle2Icon className="size-3" />
                Curriculum Aligned
              </span>
            </div>
          </div>
        </div>
      </main>

      {/* Global page footer */}
      <footer className="relative z-10 mt-6 text-center text-xs text-muted-foreground">
        <p>&copy; {new Date().getFullYear()} Bridge. All rights reserved.</p>
      </footer>
    </div>
  );
}
