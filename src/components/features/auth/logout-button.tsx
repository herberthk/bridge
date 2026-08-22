"use client";

import { useTransition } from "react";
import { LogOutIcon } from "lucide-react";

import { logout } from "@/components/auth-sync";
import { Button } from "@/components/ui/button";

export function LogoutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() => startTransition(() => void logout())}
    >
      <LogOutIcon data-icon="inline-start" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
