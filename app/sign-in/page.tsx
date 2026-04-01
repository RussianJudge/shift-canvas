import { redirect } from "next/navigation";

import { SignInPanel } from "@/components/sign-in-panel";
import { getAppSession, getSessionHomePath } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const session = await getAppSession();

  if (session) {
    redirect(getSessionHomePath(session));
  }

  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month);
  const schedules = snapshot.schedules.map((schedule) => ({
    id: schedule.id,
    name: schedule.name,
  }));
  const employees = snapshot.schedules
    .flatMap((schedule) =>
      schedule.employees.map((employee) => ({
        id: employee.id,
        name: employee.name,
        scheduleId: schedule.id,
        scheduleName: schedule.name,
      })),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return <SignInPanel schedules={schedules} employees={employees} />;
}
