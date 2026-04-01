"use client";

import { signIn } from "@/app/auth-actions";
import type { DemoAccount } from "@/lib/demo-users";

function getErrorMessage(error: string | undefined) {
  if (error === "missing-email") {
    return "Enter an email address to sign in.";
  }

  if (error === "auth-unavailable") {
    return "Supabase auth lookup is unavailable right now. Try again in a moment.";
  }

  if (error === "unknown-email") {
    return "That email does not have access yet. Use one of the demo accounts below.";
  }

  return "";
}

export function SignInPanel({
  accounts,
  error,
}: {
  accounts: DemoAccount[];
  error?: string;
}) {
  const errorMessage = getErrorMessage(error);

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <span className="auth-eyebrow">Shift Canvas</span>
          <h1 className="auth-title">Sign In</h1>
          <p className="auth-subtitle">Use an email to enter the demo workspace.</p>
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

        <div className="auth-directory">
          <div className="auth-directory__header">
            <strong>Demo accounts</strong>
            <span>These emails should exist in Supabase auth and profiles.</span>
          </div>
          <div className="auth-directory__list">
            {accounts.map((account) => (
              <article key={account.email} className="auth-account">
                <div>
                  <span className="auth-account__role">{account.roleTitle}</span>
                  <strong>{account.email}</strong>
                </div>
                <p>{account.helperText}</p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
