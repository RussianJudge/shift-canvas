"use client";

import { signIn } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";

function getErrorMessage(error: string | undefined) {
  if (error === "missing-email") {
    return "Enter an email address to sign in.";
  }

  if (error === "missing-password") {
    return "Enter your password to sign in.";
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

  if (error === "unknown-email") {
    return "That email does not have access yet.";
  }

  return "";
}

export function SignInPanel({
  error,
}: {
  error?: string;
}) {
  const errorMessage = getErrorMessage(error);

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <BrandLockup size="compact" />
          <h1 className="auth-title">Sign In</h1>
          <p className="auth-subtitle">Use your Supabase account to enter the workspace.</p>
        </div>

        <form action={signIn} className="auth-form">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" placeholder="you@company.com" required />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              placeholder="Enter your password"
              autoComplete="current-password"
              required
            />
          </label>

          {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

          <button type="submit" className="primary-button auth-submit">
            Sign in
          </button>
        </form>
      </div>
    </section>
  );
}
