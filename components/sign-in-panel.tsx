"use client";

import { useMemo, useState } from "react";

import { signIn } from "@/app/auth-actions";
import type { AppRole } from "@/lib/types";

type SignInSchedule = {
  id: string;
  name: string;
};

type SignInEmployee = {
  id: string;
  name: string;
  scheduleId: string;
  scheduleName: string;
};

export function SignInPanel({
  schedules,
  employees,
}: {
  schedules: SignInSchedule[];
  employees: SignInEmployee[];
}) {
  const [role, setRole] = useState<AppRole>("worker");
  const [selectedScheduleId, setSelectedScheduleId] = useState(schedules[0]?.id ?? "");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(employees[0]?.id ?? "");

  const selectedEmployee = useMemo(
    () => employees.find((employee) => employee.id === selectedEmployeeId) ?? null,
    [employees, selectedEmployeeId],
  );

  return (
    <section className="auth-shell">
      <div className="auth-panel">
        <div className="auth-panel__copy">
          <span className="auth-eyebrow">Shift Canvas</span>
          <h1 className="auth-title">Sign In</h1>
          <p className="auth-subtitle">Choose the role and workspace view you want to enter.</p>
        </div>

        <form action={signIn} className="auth-form">
          <label className="field">
            <span>Role</span>
            <select
              name="role"
              value={role}
              onChange={(event) => setRole(event.target.value as AppRole)}
            >
              <option value="admin">Admin</option>
              <option value="leader">Leader</option>
              <option value="worker">Worker</option>
            </select>
          </label>

          {role === "leader" ? (
            <label className="field">
              <span>Assigned shift</span>
              <select
                name="scheduleId"
                value={selectedScheduleId}
                onChange={(event) => setSelectedScheduleId(event.target.value)}
              >
                {schedules.map((schedule) => (
                  <option key={schedule.id} value={schedule.id}>
                    Shift {schedule.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          {role === "worker" ? (
            <>
              <label className="field">
                <span>Worker</span>
                <select
                  name="employeeId"
                  value={selectedEmployeeId}
                  onChange={(event) => setSelectedEmployeeId(event.target.value)}
                >
                  {employees.map((employee) => (
                    <option key={employee.id} value={employee.id}>
                      {employee.name}
                    </option>
                  ))}
                </select>
              </label>
              {selectedEmployee ? (
                <div className="auth-selection-note">
                  <strong>{selectedEmployee.name}</strong>
                  <span>Shift {selectedEmployee.scheduleName}</span>
                </div>
              ) : null}
            </>
          ) : null}

          <button type="submit" className="primary-button auth-submit">
            Enter workspace
          </button>
        </form>
      </div>
    </section>
  );
}
