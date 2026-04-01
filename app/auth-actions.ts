"use server";

import { redirect } from "next/navigation";

import { clearAppSession, setAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";
import type { AppRole, AppSession } from "@/lib/types";

function isAppRole(value: FormDataEntryValue | null): value is AppRole {
  return value === "admin" || value === "leader" || value === "worker";
}

export async function signIn(formData: FormData) {
  const role = formData.get("role");

  if (!isAppRole(role)) {
    redirect("/sign-in");
  }

  const month = getCurrentMonthKey("America/Edmonton");
  const snapshot = await getPersonnelSnapshot(month);
  let session: AppSession;

  if (role === "admin") {
    session = {
      role,
      displayName: "Admin",
      scheduleId: null,
      employeeId: null,
      scheduleName: null,
    };
  } else if (role === "leader") {
    const scheduleId = String(formData.get("scheduleId") ?? "");
    const schedule = snapshot.schedules.find((entry) => entry.id === scheduleId);

    if (!schedule) {
      redirect("/sign-in");
    }

    session = {
      role,
      displayName: `Shift ${schedule.name} Leader`,
      scheduleId: schedule.id,
      employeeId: null,
      scheduleName: schedule.name,
    };
  } else {
    const employeeId = String(formData.get("employeeId") ?? "");
    const employee = snapshot.schedules.flatMap((schedule) => schedule.employees).find((entry) => entry.id === employeeId);

    if (!employee) {
      redirect("/sign-in");
    }

    const schedule = snapshot.schedules.find((entry) => entry.id === employee.scheduleId);

    session = {
      role,
      displayName: employee.name,
      scheduleId: employee.scheduleId,
      employeeId: employee.id,
      scheduleName: schedule?.name ?? null,
    };
  }

  await setAppSession(session);
  redirect(role === "worker" ? "/schedule" : "/schedule");
}

export async function signOut() {
  await clearAppSession();
  redirect("/sign-in");
}
