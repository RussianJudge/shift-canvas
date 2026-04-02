import type { SchedulerSnapshot } from "@/lib/types";

export function ProfilePanel({
  snapshot,
  employeeId,
}: {
  snapshot: SchedulerSnapshot;
  employeeId: string | null;
}) {
  const employee = snapshot.schedules.flatMap((schedule) => schedule.employees).find((entry) => entry.id === employeeId);
  const schedule = employee ? snapshot.schedules.find((entry) => entry.id === employee.scheduleId) : null;
  const competencies = snapshot.competencies.filter((competency) => employee?.competencyIds.includes(competency.id));

  if (!employee || !schedule) {
    return (
      <section className="panel">
        <div className="panel-heading">
          <h1 className="panel-title">My Profile</h1>
        </div>
        <div className="empty-state">
          <strong>Profile unavailable</strong>
          <span>This worker profile could not be found in the current workspace data.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h1 className="panel-title">My Profile</h1>
      </div>

      <div className="profile-grid">
        <div className="profile-card">
          <span className="profile-label">Name</span>
          <strong>{employee.name}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Role</span>
          <strong>{employee.role}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Shift</span>
          <strong>{schedule.name}</strong>
        </div>
        <div className="profile-card">
          <span className="profile-label">Pattern</span>
          <strong>
            {schedule.dayShiftDays}D / {schedule.nightShiftDays}N / {schedule.offDays}O
          </strong>
        </div>
      </div>

      <div className="profile-section">
        <span className="profile-label">Qualified competencies</span>
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
      </div>
    </section>
  );
}
