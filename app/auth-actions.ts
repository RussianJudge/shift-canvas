"use server";

import { redirect } from "next/navigation";

import { clearAppSession, getSessionHomePath, setAppSession } from "@/lib/auth";
import type { AppSession } from "@/lib/types";
import { getSupabaseAdminClient } from "@/lib/supabase";

/**
 * Server actions for the current email-only sign-in flow.
 *
 * The sign-in form looks up a row in `public.profiles`, derives the
 * application-scoped role information from that record, and then persists it
 * into the signed app cookie handled by `lib/auth.ts`.
 */
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

/**
 * Signs a user in by email using `public.profiles` as the application identity
 * source of truth.
 *
 * The action resolves the profile row, builds the role-aware app session used
 * by the workspace, stores that session in the signed cookie, and then sends
 * the browser to the correct landing page for that role.
 */
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
      const session: AppSession = {
        email: profile.email,
        role: profile.role,
        displayName: profile.display_name || profile.email.split("@")[0] || "User",
        scheduleId: profile.schedule_id,
        employeeId: profile.employee_id,
        scheduleName,
      };

      if (profile.schedule_id) {
        const scheduleResult = await supabase
          .from("schedules")
          .select("id, name")
          .eq("id", profile.schedule_id)
          .maybeSingle();

        if (!scheduleResult.error) {
          scheduleName = (scheduleResult.data as ScheduleRow | null)?.name ?? null;
        }

        session.scheduleName = scheduleName;
      }

      await setAppSession(session);

      redirect(getSessionHomePath(session));
    }
  }

  redirect("/sign-in?error=unknown-email");
}

/** Ends the current app session and sends the browser back to sign-in. */
export async function signOut() {
  await clearAppSession();
  redirect("/sign-in");
}
