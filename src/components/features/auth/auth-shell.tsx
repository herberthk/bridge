import Link from "next/link";

/**
 * Premium split shell for auth screens: brand panel (desktop) + form panel.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="bg-mesh bg-noise relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="gradient-border shadow-lifted grid w-full max-w-4xl overflow-hidden rounded-3xl bg-card md:grid-cols-2">
        {/* Brand panel */}
        <div className="bg-brand relative hidden flex-col justify-between p-10 text-primary-foreground md:flex">
          <div
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                "radial-gradient(24rem 16rem at 10% 0%, rgba(255,255,255,.55), transparent 60%), radial-gradient(20rem 14rem at 100% 100%, rgba(255,255,255,.4), transparent 60%)",
            }}
          />
          <Link href="/" className="relative flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-5"
                aria-hidden
              >
                <path d="M4 17c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M4 10c2.5-3 5-3 7 0s4.5 3 7 0" />
                <path d="M6 4v2M12 4v2M18 4v2" />
              </svg>
            </span>
            <span className="text-xl font-semibold tracking-tight">Bridge</span>
          </Link>

          <div className="relative flex flex-col gap-4">
            <blockquote className="text-lg font-medium text-pretty opacity-95">
              “Assessment that keeps up with the classroom — generated, proctored,
              and graded by AI.”
            </blockquote>
            <div className="flex items-center gap-3 text-sm opacity-80">
              <span className="bg-white/15 rounded-full px-3 py-1 backdrop-blur">
                AI generation
              </span>
              <span className="bg-white/15 rounded-full px-3 py-1 backdrop-blur">
                Smart proctoring
              </span>
              <span className="bg-white/15 rounded-full px-3 py-1 backdrop-blur">
                Instant feedback
              </span>
            </div>
          </div>

          <p className="relative text-xs opacity-60">
            Built for Ugandan primary &amp; secondary schools
          </p>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center gap-6 p-8 sm:p-10">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">{subtitle}</p>
          </div>
          {children}
          {footer}
        </div>
      </div>
    </div>
  );
}
