"use client";

import Link from "next/link";
import { useState } from "react";

import { signUp } from "@/app/auth-actions";
import type { DemoAccount } from "@/lib/demo-users";
import type { AppRole } from "@/lib/types";

function getErrorMessage(error: string | undefined) {
  if (error === "missing-email") {
    return "Enter an email address to create demo access.";
  }

  if (error === "invalid-role") {
    return "Choose a valid role before continuing.";
  }

  return "";
}

export function SignUpPanel({
  accounts,
  error,
}: {
  accounts: DemoAccount[];
  error?: string;
}) {
  const [selectedRole, setSelectedRole] = useState<AppRole>("worker");
  const selectedTemplate = accounts.find((account) => account.role === selectedRole) ?? accounts[0];
  const errorMessage = getErrorMessage(error);

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <span className="auth-eyebrow">Shift Canvas</span>
          <h1 className="auth-title">Sign Up</h1>
          <p className="auth-subtitle">Create a demo session with an email and the access level you want to preview.</p>
        </div>

        <form action={signUp} className="auth-form">
          <label className="field">
            <span>Email</span>
            <input type="email" name="email" placeholder={selectedTemplate.email} required />
          </label>

          <label className="field">
            <span>Access level</span>
            <select
              name="role"
              value={selectedRole}
              onChange={(event) => setSelectedRole(event.target.value as AppRole)}
            >
              {accounts.map((account) => (
                <option key={account.role} value={account.role}>
                  {account.roleTitle}
                </option>
              ))}
            </select>
          </label>

          <div className="auth-selection-note">
            <strong>{selectedTemplate.roleTitle} template</strong>
            <span>{selectedTemplate.helperText}</span>
          </div>

          {errorMessage ? <p className="auth-error">{errorMessage}</p> : null}

          <button type="submit" className="primary-button auth-submit">
            Create demo access
          </button>
        </form>

        <div className="auth-directory">
          <div className="auth-directory__header">
            <strong>Default demo users</strong>
            <span>Each authorization level starts with a ready-made account.</span>
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

        <p className="auth-switch">
          Already have demo access? <Link href="/sign-in">Sign in</Link>
        </p>
      </div>
    </section>
  );
}
