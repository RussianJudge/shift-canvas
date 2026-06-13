"use client";

import { useActionState } from "react";

import { requestProfilePasswordReset, type ProfilePasswordResetState } from "@/app/auth-actions";
import type { AppSession, ProfileSnapshot } from "@/lib/types";

const initialPasswordResetState: ProfilePasswordResetState = {
  status: "idle",
  message: "",
};

export function ProfilePanel({
  snapshot,
  viewer,
}: {
  snapshot: ProfileSnapshot;
  viewer: AppSession;
}) {
  const { employee, schedule, competencies } = snapshot;
  const [passwordResetState, passwordResetAction, isRequestingPasswordReset] = useActionState(
    requestProfilePasswordReset,
    initialPasswordResetState,
  );

  return (
    <section className="panel">
      <div className="panel-heading">
        <h1 className="panel-title">My Profile</h1>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <span className="profile-label">Name</span>
          <strong>{employee?.name ?? viewer.displayName}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Role</span>
          <strong>{viewer.role}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Email</span>
          <strong>{viewer.email}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Shift</span>
          <strong>{schedule?.name ?? "No assigned shift"}</strong>
        </div>
        {schedule ? (
          <div className="profile-card">
            <span className="profile-label">Pattern</span>
            <strong>
              {schedule.dayShiftDays}D / {schedule.nightShiftDays}N / {schedule.offDays}O
            </strong>
          </div>
        ) : null}
      </div>

      <div className="profile-section">
        <span className="profile-label">Qualified competencies</span>
        {competencies.length > 0 ? (
          <div className="table-pills">
            {competencies.map((competency) => (
              <span
                key={competency.id}
                className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}
              >
                {competency.code}
              </span>
            ))}
          </div>
        ) : (
          <span>No linked employee competencies.</span>
        )}
      </div>

      <div className="profile-section profile-section--password">
        <div>
          <span className="profile-label">Password</span>
          <strong>Change password</strong>
          <span>Send a secure password-change link to your account email.</span>
        </div>
        <form action={passwordResetAction}>
          <button type="submit" className="primary-button" disabled={isRequestingPasswordReset}>
            {isRequestingPasswordReset ? "Sending..." : "Send password link"}
          </button>
        </form>
        {passwordResetState.message ? (
          <p className={passwordResetState.status === "error" ? "auth-error" : "auth-notice"}>
            {passwordResetState.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}
