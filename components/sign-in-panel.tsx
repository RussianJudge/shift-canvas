"use client";

import { useState } from "react";

import { signIn, signUp } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";

type AuthMode = "sign-in" | "create";

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

  if (error === "unknown-email") {
    return "That email does not have access yet.";
  }

  return "";
}

function getNoticeMessage(notice: string | undefined) {
  if (notice === "account-created") {
    return "Account created. If email confirmation is enabled, confirm your email first, then sign in.";
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

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <BrandLockup size="compact" />
          <h1 className="auth-title">{isCreateMode ? "Create Account" : "Sign In"}</h1>
          <p className="auth-subtitle">
            {isCreateMode
              ? "Create your Supabase account, then an admin can confirm your workspace access."
              : "Use your Supabase account to enter the workspace."}
          </p>
        </div>

        <form action={isCreateMode ? signUp : signIn} className="auth-form">
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
            {isCreateMode ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="auth-mode-switch">
          <span>{isCreateMode ? "Already have an account?" : "Need an account?"}</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setMode(isCreateMode ? "sign-in" : "create")}
          >
            {isCreateMode ? "Sign in" : "Create account"}
          </button>
        </div>
      </div>
    </section>
  );
}
