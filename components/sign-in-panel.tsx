"use client";

import { signIn } from "@/app/auth-actions";
import { BrandLockup } from "@/components/brand-lockup";

function getErrorMessage(error: string | undefined) {
  if (error === "missing-email") {
    return "Enter an email address to sign in.";
  }

  if (error === "auth-unavailable") {
    return "Supabase auth lookup is unavailable right now. Try again in a moment.";
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
          <BrandLockup size="compact" subtitle="Secure workforce access" />
          <h1 className="auth-title">Sign In</h1>
          <p className="auth-subtitle">Use your email to enter the workspace.</p>
        </div>

        <form action={signIn} className="auth-form">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" placeholder="you@company.com" required />
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
