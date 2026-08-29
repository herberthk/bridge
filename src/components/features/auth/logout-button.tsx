"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon } from "lucide-react";

import { logout } from "@/components/auth-sync";
import { Button } from "@/components/ui/button";

export function LogoutButton({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await logout();
          router.push("/login");
          router.refresh();
        })
      }
    >
      <LogOutIcon data-icon="inline-start" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
