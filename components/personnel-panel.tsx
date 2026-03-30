import type { Competency, SchedulerSnapshot } from "@/lib/types";

function isCompetency(competency: Competency | undefined): competency is Competency {
  return Boolean(competency);
}

export function PersonnelPanel({
  snapshot,
}: {
  snapshot: SchedulerSnapshot;
}) {
  const employees = snapshot.teams.flatMap((team) =>
    team.employees.map((employee) => ({
      ...employee,
      teamName: team.name,
      unitName: snapshot.productionUnits.find((unit) => unit.id === team.unitId)?.name ?? "Unassigned",
      competencies: employee.competencyIds
        .map((competencyId) => snapshot.competencies.find((competency) => competency.id === competencyId))
        .filter(isCompetency),
    })),
  );

  return (
    <section className="panel-frame">
      <div className="panel-heading">
        <div>
          <span className="panel-eyebrow">Personnel</span>
          <h1 className="panel-title">People and competency coverage</h1>
        </div>
        <p className="panel-copy">
          Review every employee&apos;s team, rotation code, and post coverage before placing them on
          the monthly grid.
        </p>
      </div>

      <div className="summary-row">
        <div className="summary-stat">
          <span>Total employees</span>
          <strong>{employees.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Teams</span>
          <strong>{snapshot.teams.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Production units</span>
          <strong>{snapshot.productionUnits.length}</strong>
        </div>
        <div className="summary-stat">
          <span>Competencies</span>
          <strong>{snapshot.competencies.length}</strong>
        </div>
      </div>

      <div className="personnel-table-wrap">
        <table className="personnel-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Team</th>
              <th>Unit</th>
              <th>Rotation</th>
              <th>Competencies</th>
            </tr>
          </thead>
          <tbody>
            {employees.map((employee) => (
              <tr key={employee.id}>
                <td>
                  <strong>{employee.name}</strong>
                </td>
                <td>{employee.role}</td>
                <td>{employee.teamName}</td>
                <td>{employee.unitName}</td>
                <td>{employee.scheduleCode}</td>
                <td>
                  <div className="table-pills">
                    {employee.competencies.map((competency) => (
                      <span
                        key={competency.id}
                        className={`legend-pill legend-pill--${competency.colorToken.toLowerCase()}`}
                      >
                        {competency.code}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
