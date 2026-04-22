"use client";

import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";

import { BrandLockup } from "@/components/brand-lockup";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Lets a user finish Supabase's password recovery flow.
 *
 * Supabase recovery links create a short-lived browser auth session. This
 * component waits for that recovery session, then calls `updateUser()` with the
 * new password. Keeping this in a client component is important because the
 * recovery tokens arrive in the browser URL rather than in the server action.
 */
export function ResetPasswordPanel() {
  const supabase = useMemo(() => {
    if (!supabaseUrl || !supabaseAnonKey) {
      return null;
    }

    return createClient(supabaseUrl, supabaseAnonKey);
  }, []);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [hasRecoverySession, setHasRecoverySession] = useState(false);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function prepareRecoverySession() {
      if (!supabase) {
        setFormError("Supabase authentication is unavailable right now. Try again in a moment.");
        setIsCheckingSession(false);
        return;
      }

      const url = new URL(window.location.href);
      const authCode = url.searchParams.get("code");

      if (authCode) {
        const { error } = await supabase.auth.exchangeCodeForSession(authCode);

        if (error && isMounted) {
          setFormError("That reset link is invalid or expired. Request a fresh password reset email.");
          setIsCheckingSession(false);
          return;
        }

        url.searchParams.delete("code");
        window.history.replaceState(window.history.state, "", url.toString());
      }

      const { data, error } = await supabase.auth.getSession();

      if (!isMounted) {
        return;
      }

      if (error) {
        setFormError("Could not read the reset session. Request a fresh password reset email.");
      }

      setHasRecoverySession(Boolean(data.session));
      setIsCheckingSession(false);
    }

    const {
      data: { subscription },
    } =
      supabase?.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY" || session) {
          setHasRecoverySession(true);
          setIsCheckingSession(false);
        }
      }) ?? { data: { subscription: null } };

    prepareRecoverySession();

    return () => {
      isMounted = false;
      subscription?.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    setNotice("");

    if (!supabase) {
      setFormError("Supabase authentication is unavailable right now. Try again in a moment.");
      return;
    }

    if (!hasRecoverySession) {
      setFormError("Open the latest reset link from your email before setting a new password.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!password) {
      setFormError("Enter a new password.");
      return;
    }

    if (password !== confirmPassword) {
      setFormError("Those passwords do not match.");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    setIsSaving(false);

    if (error) {
      setFormError(
        error.message.toLowerCase().includes("password")
          ? "Choose a stronger password. Supabase rejected that password."
          : "Could not update the password. Request a fresh reset link and try again.",
      );
      return;
    }

    await supabase.auth.signOut();
    event.currentTarget.reset();
    setHasRecoverySession(false);
    setNotice("Password updated. You can sign in with the new password now.");
  }

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <BrandLockup size="compact" />
          <h1 className="auth-title">Set New Password</h1>
          <p className="auth-subtitle">
            Enter a new password for your Supabase account. The reset link can only be used for a short time.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>New Password</span>
            <input
              type="password"
              name="password"
              placeholder="Create a new password"
              autoComplete="new-password"
              disabled={isCheckingSession || !hasRecoverySession || isSaving}
              required
            />
          </label>

          <label className="field">
            <span>Confirm Password</span>
            <input
              type="password"
              name="confirmPassword"
              placeholder="Re-enter your new password"
              autoComplete="new-password"
              disabled={isCheckingSession || !hasRecoverySession || isSaving}
              required
            />
          </label>

          {isCheckingSession ? <p className="auth-notice">Checking your reset link...</p> : null}
          {formError ? <p className="auth-error">{formError}</p> : null}
          {!formError && notice ? <p className="auth-notice">{notice}</p> : null}
          {!isCheckingSession && !hasRecoverySession && !notice ? (
            <p className="auth-error">This reset link is missing, expired, or already used.</p>
          ) : null}

          <button
            type="submit"
            className="primary-button auth-submit"
            disabled={isCheckingSession || !hasRecoverySession || isSaving}
          >
            {isSaving ? "Updating password..." : "Update password"}
          </button>
        </form>

        <div className="auth-mode-switch">
          <span>Need another reset email?</span>
          <Link className="ghost-button" href="/sign-in?mode=reset">
            Request reset
          </Link>
          <Link className="ghost-button" href="/sign-in">
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
