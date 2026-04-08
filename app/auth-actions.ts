"use server";

import { redirect } from "next/navigation";

import { clearAppSession, getAppSession, getSessionHomePath, setAppSession } from "@/lib/auth";
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
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type ScheduleRow = {
  id: string;
  name: string;
};

type NamedScopeRow = {
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
      .select("email, display_name, role, schedule_id, employee_id, company_id, site_id, business_area_id")
      .eq("email", email)
      .maybeSingle();

    if (profileResult.error) {
      redirect("/sign-in?error=auth-unavailable");
    }

    const profile = profileResult.data as ProfileRow | null;

    if (profile) {
      let scheduleName: string | null = null;
      let companyName = profile.company_id;
      let siteName = profile.site_id;
      let businessAreaName = profile.business_area_id;
      const session: AppSession = {
        email: profile.email,
        role: profile.role,
        displayName: profile.display_name || profile.email.split("@")[0] || "User",
        scheduleId: profile.schedule_id,
        employeeId: profile.employee_id,
        scheduleName,
        companyId: profile.company_id,
        siteId: profile.site_id,
        businessAreaId: profile.business_area_id,
        companyName,
        siteName,
        businessAreaName,
        activeSiteId: profile.role === "admin" ? null : profile.site_id,
        activeBusinessAreaId: profile.role === "admin" ? null : profile.business_area_id,
      };

      const [scheduleResult, companyResult, siteResult, businessAreaResult] = await Promise.all([
        profile.schedule_id
          ? supabase
              .from("schedules")
              .select("id, name")
              .eq("id", profile.schedule_id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
        supabase
          .from("companies")
          .select("id, name")
          .eq("id", profile.company_id)
          .maybeSingle(),
        supabase
          .from("sites")
          .select("id, name")
          .eq("id", profile.site_id)
          .maybeSingle(),
        supabase
          .from("business_areas")
          .select("id, name")
          .eq("id", profile.business_area_id)
          .maybeSingle(),
      ]);

      if (!scheduleResult.error) {
        scheduleName = (scheduleResult.data as ScheduleRow | null)?.name ?? null;
      }

      if (!companyResult.error) {
        companyName = (companyResult.data as NamedScopeRow | null)?.name ?? companyName;
      }

      if (!siteResult.error) {
        siteName = (siteResult.data as NamedScopeRow | null)?.name ?? siteName;
      }

      if (!businessAreaResult.error) {
        businessAreaName = (businessAreaResult.data as NamedScopeRow | null)?.name ?? businessAreaName;
      }

      session.scheduleName = scheduleName;
      session.companyName = companyName;
      session.siteName = siteName;
      session.businessAreaName = businessAreaName;

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

/**
 * Updates the admin's current viewing context without changing their actual
 * profile assignment.
 *
 * This is intentionally session-only state. Admins remain company-wide in
 * authority, but they can choose which site/business-area slice the app should
 * render at a given moment.
 */
export async function setAdminViewingScope(input: {
  siteId: string | null;
  businessAreaId: string | null;
}) {
  const session = await getAppSession();

  if (!session || session.role !== "admin") {
    return {
      ok: false,
      message: "Only admins can change the viewing scope.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Admin viewing scope is unavailable.",
    };
  }

  const nextSiteId = input.siteId || null;
  const nextBusinessAreaId = input.businessAreaId || null;

  if (nextBusinessAreaId && !nextSiteId) {
    return {
      ok: false,
      message: "Choose a site before choosing a business area.",
    };
  }

  if (nextSiteId) {
    const siteResult = await supabase
      .from("sites")
      .select("id, company_id")
      .eq("id", nextSiteId)
      .maybeSingle();

    const site = siteResult.data as { id: string; company_id: string } | null;

    if (siteResult.error || !site || site.company_id !== session.companyId) {
      return {
        ok: false,
        message: "That site is not available in your company.",
      };
    }
  }

  if (nextBusinessAreaId) {
    const businessAreaResult = await supabase
      .from("business_areas")
      .select("id, site_id")
      .eq("id", nextBusinessAreaId)
      .maybeSingle();

    const businessArea = businessAreaResult.data as { id: string; site_id: string } | null;

    if (businessAreaResult.error || !businessArea || businessArea.site_id !== nextSiteId) {
      return {
        ok: false,
        message: "That business area does not belong to the selected site.",
      };
    }
  }

  await setAppSession({
    ...session,
    activeSiteId: nextSiteId,
    activeBusinessAreaId: nextBusinessAreaId,
  });

  return {
    ok: true,
    message: "Viewing scope updated.",
  };
}
