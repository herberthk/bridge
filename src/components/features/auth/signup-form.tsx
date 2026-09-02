"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, ArrowRightIcon, EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { authClient } from "@/lib/firebase/client";
import { signupSchema, type SignupInput } from "@/lib/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Alert, AlertDescription } from "@/components/ui/alert";

/** Public "join as a normal user" form — account + profile, then onboarding. */
export function SignupForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: "", email: "", password: "" },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const cred = await createUserWithEmailAndPassword(
        authClient(),
        values.email,
        values.password,
      );
      // Keep the displayName in the ID token flow: the register API sets the
      // profile displayName server-side (Auth displayName updated below via
      // the client SDK is not needed — the doc is the source of truth).
      const idToken = await cred.user.getIdToken();
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, displayName: values.displayName }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: true; home: string }
        | { ok: false; error: string }
        | null;
      if (!res.ok || !data || !("ok" in data) || !data.ok) {
        await authClient().signOut();
        setServerError(data && "error" in data ? data.error : "Sign-up failed.");
        return;
      }
      toast.success("Welcome to Bridge!");
      router.replace(data.home);
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      if (code === "auth/email-already-in-use") {
        setServerError("An account with this email already exists — sign in instead.");
      } else if (code === "auth/weak-password") {
        setServerError("That password is too weak.");
      } else if (code === "auth/invalid-email") {
        setServerError("Enter a valid email address.");
      } else if (code === "auth/network-request-failed") {
        setServerError("Network error — check your internet connection.");
      } else if (code.startsWith("auth/")) {
        setServerError("Sign-up failed. Please try again.");
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

        <Field data-invalid={form.formState.errors.displayName ? true : undefined}>
          <FieldLabel htmlFor="displayName">Full name</FieldLabel>
          <Input
            id="displayName"
            autoComplete="name"
            placeholder="e.g. Sarah Kimani"
            aria-invalid={!!form.formState.errors.displayName}
            {...form.register("displayName")}
          />
          {form.formState.errors.displayName && (
            <FieldError>{form.formState.errors.displayName.message}</FieldError>
          )}
        </Field>

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
              autoComplete="new-password"
              placeholder="10+ chars, mixed case, number"
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
              <span>Creating account…</span>
            </>
          ) : (
            <>
              <span>Create your account</span>
              <ArrowRightIcon data-icon="inline-end" />
            </>
          )}
        </Button>

        <p className="text-muted-foreground text-center text-xs">
          Already have an account?{" "}
          <Link href="/login" className="text-primary font-medium hover:underline">
            Sign in
          </Link>
        </p>
      </FieldGroup>
    </form>
  );
}
