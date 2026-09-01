"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/firebase/client";
import { loginSchema, type LoginInput } from "@/lib/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

export function LoginForm({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const cred = await signInWithEmailAndPassword(
        authClient(),
        values.email,
        values.password,
      );
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; home: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        await authClient().signOut();
        setServerError(data && "error" in data ? data.error : "Sign-in failed.");
        return;
      }
      toast.success("Welcome back!");
      const safeNext =
        nextPath && nextPath.startsWith("/") && !nextPath.startsWith("//") && !nextPath.startsWith("/\\") ? nextPath : data.home;
      router.replace(safeNext);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found"
      ) {
        setServerError("Incorrect email or password.");
      } else if (code === "auth/too-many-requests") {
        setServerError("Too many attempts. Try again in a few minutes.");
      } else if (code === "auth/network-request-failed") {
        setServerError("Network error — check your internet connection.");
      } else if (code.startsWith("auth/")) {
        setServerError("Sign-in failed. Please try again.");
      } else {
        setServerError("Something went wrong. Please try again.");
      }
    }
  });

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate>
      <FieldGroup>
        {serverError && (
          <Alert variant="destructive">
            <AlertCircleIcon data-icon="inline-start" />
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={form.formState.errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@school.ac.ug"
            aria-invalid={!!form.formState.errors.email}
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <FieldError>{form.formState.errors.email.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={form.formState.errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Your password"
              className="pr-10"
              aria-invalid={!!form.formState.errors.password}
              {...form.register("password")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex w-10 items-center justify-center transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
          {form.formState.errors.password && (
            <FieldError>{form.formState.errors.password.message}</FieldError>
          )}
        </Field>

        <Button
          type="submit"
          className="shadow-glow mt-2 h-10 w-full font-medium"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (
            <>
              <Loader2Icon className="size-4 animate-spin" data-icon="inline-start" />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              <span>Sign in to Portal</span>
              <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>
      </FieldGroup>
    </form>
  );
}
