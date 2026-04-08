import { ProfilePanel } from "@/components/profile-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";
import { getSupabaseAdminClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await requireAppSession(["worker"]);
  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month, session);
  const allEmployees = snapshot.schedules.flatMap((schedule) => schedule.employees);
  const supabase = getSupabaseAdminClient();
  const displayName = session.displayName.trim().toLowerCase();
  const emailLocalPart = session.email.split("@")[0]?.trim().toLowerCase() ?? "";
  const profileEmployeeId =
    supabase
      ? (
          await supabase
            .from("profiles")
            .select("employee_id")
            .eq("email", session.email)
            .maybeSingle()
        ).data?.employee_id ?? null
      : null;
  const resolvedEmployeeId =
    profileEmployeeId ??
    session.employeeId ??
    allEmployees.find((employee) => {
      const employeeName = employee.name.trim().toLowerCase();
      return (
        employeeName === displayName ||
        employeeName === emailLocalPart ||
        employeeName.includes(displayName) ||
        displayName.includes(employeeName)
      );
    })?.id ??
    null;

  return (
    <WorkspaceShell viewer={session}>
      <ProfilePanel snapshot={snapshot} employeeId={resolvedEmployeeId} />
    </WorkspaceShell>
  );
}
