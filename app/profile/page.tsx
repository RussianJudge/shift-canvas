import { redirect } from "next/navigation";

import { ProfilePanel } from "@/components/profile-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireAppSession(["worker"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month);
  const allEmployees = snapshot.schedules.flatMap((schedule) => schedule.employees);
  const displayName = session.displayName.trim().toLowerCase();
  const emailLocalPart = session.email.split("@")[0]?.trim().toLowerCase() ?? "";
  const resolvedEmployeeId =
    session.employeeId ??
    allEmployees.find((employee) => {
      const employeeName = employee.name.trim().toLowerCase();
      return employeeName === displayName || employeeName === emailLocalPart;
    })?.id ??
    null;

  if (!resolvedEmployeeId) {
    redirect("/schedule");
  }

  return (
    <WorkspaceShell viewer={session}>
      <ProfilePanel snapshot={snapshot} employeeId={resolvedEmployeeId} />
    </WorkspaceShell>
  );
}
