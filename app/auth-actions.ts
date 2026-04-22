"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { clearAppSession, getAppSession, getSessionHomePath, setAppSession } from "@/lib/auth";
import type { AppSession } from "@/lib/types";
import { getSupabaseAdminClient, getSupabaseServerClient } from "@/lib/supabase";

/**
 * Server actions for the Supabase-backed sign-in flow.
 *
 * Supabase Auth verifies that the visitor owns the email/password pair. The app
 * then loads `public.profiles` for authorization details like role, linked
 * employee, company, site, and business area before writing the signed app
 * cookie handled by `lib/auth.ts`.
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

/** Builds the public URL Supabase should send users back to after auth emails. */
async function getAuthRedirectOrigin() {
  const headerStore = await headers();
  const requestOrigin = headerStore.get("origin");

  if (requestOrigin) {
    return requestOrigin;
  }

  if (process.env.NEXT_PUBLIC_SITE_URL) {
    return process.env.NEXT_PUBLIC_SITE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

/**
 * Signs a user in with Supabase Auth, then loads app-specific authorization
 * details from `public.profiles`.
 *
 * This two-step design keeps authentication and authorization separate:
 * Supabase confirms the password, while `profiles` decides what workspace data
 * the authenticated person is allowed to see.
 */
export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email) {
    redirect("/sign-in?error=missing-email");
  }

  if (!password) {
    redirect("/sign-in?error=missing-password");
  }

  const authClient = getSupabaseServerClient();
  const supabase = getSupabaseAdminClient();

  if (authClient && supabase) {
    const authResult = await authClient.auth.signInWithPassword({
      email,
      password,
    });

    if (authResult.error || !authResult.data.user) {
      redirect("/sign-in?error=invalid-credentials");
    }

    const profileResult = await supabase
      .from("profiles")
      .select("email, display_name, role, schedule_id, employee_id, company_id, site_id, business_area_id")
      .eq("id", authResult.data.user.id)
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

    redirect("/sign-in?error=profile-missing");
  }

  redirect("/sign-in?error=auth-unavailable");
}

/**
 * Creates a Supabase Auth account from the sign-in screen.
 *
 * Supabase owns the password storage and hashing. The database trigger on
 * `auth.users` creates the matching `profiles` row, which keeps the app's role
 * and scope setup in one database-side place instead of duplicating it here.
 */
export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();

  if (!email) {
    redirect("/sign-in?mode=create&error=missing-email");
  }

  if (!firstName || !lastName) {
    redirect("/sign-in?mode=create&error=missing-name");
  }

  if (!password) {
    redirect("/sign-in?mode=create&error=missing-password");
  }

  if (password !== confirmPassword) {
    redirect("/sign-in?mode=create&error=password-mismatch");
  }

  const authClient = getSupabaseServerClient();

  if (!authClient) {
    redirect("/sign-in?mode=create&error=auth-unavailable");
  }

  const { error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`,
        role: "worker",
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();

    if (message.includes("already") || message.includes("registered")) {
      redirect("/sign-in?mode=create&error=account-exists");
    }

    if (message.includes("password")) {
      redirect("/sign-in?mode=create&error=weak-password");
    }

    redirect("/sign-in?mode=create&error=signup-failed");
  }

  redirect("/sign-in?notice=account-created");
}

/**
 * Sends Supabase's password recovery email from the sign-in screen.
 *
 * This action only starts the reset. Supabase creates a temporary recovery
 * session when the emailed link is opened, and the `/reset-password` page uses
 * that browser-side session to write the new password.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/sign-in?mode=reset&error=missing-email");
  }

  const authClient = getSupabaseServerClient();

  if (!authClient) {
    redirect("/sign-in?mode=reset&error=auth-unavailable");
  }

  const origin = await getAuthRedirectOrigin();
  const { error } = await authClient.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/reset-password`,
  });

  if (error) {
    redirect("/sign-in?mode=reset&error=reset-failed");
  }

  redirect("/sign-in?mode=reset&notice=reset-sent");
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
