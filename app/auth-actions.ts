"use server";

import { redirect } from "next/navigation";

import { clearAppSession, setAppSession } from "@/lib/auth";
import { getDemoAccountByEmail } from "@/lib/demo-users";
import { getSupabaseAdminClient } from "@/lib/supabase";

type ProfileRow = {
  email: string;
  display_name: string;
  role: "admin" | "leader" | "worker";
  schedule_id: string | null;
  employee_id: string | null;
};

type ScheduleRow = {
  id: string;
  name: string;
};

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/sign-in?error=missing-email");
  }

  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const profileResult = await supabase
      .from("profiles")
      .select("email, display_name, role, schedule_id, employee_id")
      .eq("email", email)
      .maybeSingle();

    if (profileResult.error) {
      redirect("/sign-in?error=auth-unavailable");
    }

    const profile = profileResult.data as ProfileRow | null;

    if (profile) {
      let scheduleName: string | null = null;

      if (profile.schedule_id) {
        const scheduleResult = await supabase
          .from("schedules")
          .select("id, name")
          .eq("id", profile.schedule_id)
          .maybeSingle();

        if (!scheduleResult.error) {
          scheduleName = (scheduleResult.data as ScheduleRow | null)?.name ?? null;
        }
      }

      await setAppSession({
        email: profile.email,
        role: profile.role,
        displayName: profile.display_name || profile.email.split("@")[0] || "User",
        scheduleId: profile.schedule_id,
        employeeId: profile.employee_id,
        scheduleName,
      });

      redirect("/schedule");
    }
  }

  const account = getDemoAccountByEmail(email);

  if (!account) {
    redirect("/sign-in?error=unknown-email");
  }

  await setAppSession(account);
  redirect("/schedule");
}

export async function signOut() {
  await clearAppSession();
  redirect("/sign-in");
}
