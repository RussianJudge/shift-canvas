/**
 * Resolves the crew a signed-in user belongs to.
 *
 * `profiles.schedule_id` and `employees.schedule_id` both hold it, but Personnel
 * only writes the employee row, so the profile copy is left behind whenever
 * someone moves between crews. The employee record is the one the schedule grid,
 * the rosters and the personnel page all edit, so it wins wherever a profile is
 * linked to an employee.
 *
 * A linked employee with no crew resolves to none. Falling back to the profile
 * there would hand an unassigned worker the crew they used to be on, which is
 * the same staleness in a quieter form.
 */
export function resolveSessionScheduleId(profile: {
  employeeId: string | null;
  scheduleId: string | null;
  employeeScheduleId: string | null;
}) {
  return profile.employeeId ? profile.employeeScheduleId : profile.scheduleId;
}
