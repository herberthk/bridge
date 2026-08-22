"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { AuthSync } from "@/components/auth-sync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>{children}</TooltipProvider>
      <AuthSync />
      <Toaster position="top-right" richColors closeButton />
      <ServiceWorkerRegistrar />
    </ThemeProvider>
  );
}
