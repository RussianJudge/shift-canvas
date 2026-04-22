"use client";

import { useState } from "react";

import { requestPasswordReset, signIn, signUp } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";

type AuthMode = "sign-in" | "create" | "reset";

function getErrorMessage(error: string | undefined) {
  if (error === "missing-email") {
    return "Enter an email address to sign in.";
  }

  if (error === "missing-password") {
    return "Enter your password to sign in.";
  }

  if (error === "missing-name") {
    return "Enter your first and last name to create an account.";
  }

  if (error === "auth-unavailable") {
    return "Supabase authentication is unavailable right now. Try again in a moment.";
  }

  if (error === "invalid-credentials") {
    return "That email or password is not correct.";
  }

  if (error === "profile-missing") {
    return "Your login works, but your workspace profile is missing. Ask an admin to finish setting up your access.";
  }

  if (error === "password-mismatch") {
    return "Those passwords do not match.";
  }

  if (error === "account-exists") {
    return "That email already has an account. Sign in instead.";
  }

  if (error === "weak-password") {
    return "Choose a stronger password. Supabase rejected that password.";
  }

  if (error === "signup-failed") {
    return "Could not create that account. Check the details and try again.";
  }

  if (error === "reset-failed") {
    return "Could not send a reset email. Check the address and try again.";
  }

  if (error === "unknown-email") {
    return "That email does not have access yet.";
  }

  return "";
}

function getNoticeMessage(notice: string | undefined) {
  if (notice === "account-created") {
    return "Account created. If email confirmation is enabled, confirm your email first, then sign in.";
  }

  if (notice === "reset-sent") {
    return "If that email has an account, a password reset link is on the way.";
  }

  return "";
}

export function SignInPanel({
  error,
  notice,
  initialMode = "sign-in",
}: {
  error?: string;
  notice?: string;
  initialMode?: AuthMode;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const errorMessage = getErrorMessage(error);
  const noticeMessage = getNoticeMessage(notice);
  const isCreateMode = mode === "create";
  const isResetMode = mode === "reset";
  const formAction = isCreateMode ? signUp : isResetMode ? requestPasswordReset : signIn;

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <BrandLockup size="compact" />
          <h1 className="auth-title">
            {isCreateMode ? "Create Account" : isResetMode ? "Reset Password" : "Sign In"}
          </h1>
          <p className="auth-subtitle">
            {isCreateMode
              ? "Create your Supabase account, then an admin can confirm your workspace access."
              : isResetMode
                ? "Enter your email and we will send a secure password reset link."
                : "Use your Supabase account to enter the workspace."}
          </p>
        </div>

        <form action={formAction} className="auth-form">
          {isCreateMode ? (
            <div className="auth-name-grid">
              <label className="field">
                <span>First Name</span>
                <input
                  type="text"
                  name="firstName"
                  placeholder="First name"
                  autoComplete="given-name"
                  required
                />
              </label>

              <label className="field">
                <span>Last Name</span>
                <input
                  type="text"
                  name="lastName"
                  placeholder="Last name"
                  autoComplete="family-name"
                  required
                />
              </label>
            </div>
          ) : null}

          <label className="field">
            <span>Email</span>
            <input type="email" name="email" placeholder="you@company.com" autoComplete="email" required />
          </label>

          {!isResetMode ? (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                name="password"
                placeholder={isCreateMode ? "Create a password" : "Enter your password"}
                autoComplete={isCreateMode ? "new-password" : "current-password"}
                required
              />
            </label>
          ) : null}

          {isCreateMode ? (
            <label className="field">
              <span>Confirm Password</span>
              <input
                type="password"
                name="confirmPassword"
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
              />
            </label>
          ) : null}

          {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}
          {!errorMessage && noticeMessage ? <p className="auth-notice">{noticeMessage}</p> : null}

          <button type="submit" className="primary-button auth-submit">
            {isCreateMode ? "Create account" : isResetMode ? "Send reset link" : "Sign in"}
          </button>
        </form>

        <div className="auth-mode-switch">
          <span>
            {isCreateMode
              ? "Already have an account?"
              : isResetMode
                ? "Remember your password?"
                : "Need an account?"}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setMode(isCreateMode || isResetMode ? "sign-in" : "create")}
          >
            {isCreateMode || isResetMode ? "Sign in" : "Create account"}
          </button>
          {!isCreateMode && !isResetMode ? (
            <button type="button" className="ghost-button" onClick={() => setMode("reset")}>
              Forgot password?
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
