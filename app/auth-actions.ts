"use server";

import { createHash, randomBytes } from "crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";

import { clearAppSession, getAppSession, getSessionHomePath, setAppSession } from "@/lib/auth";
import { buildCreateAccountInviteUrl, sendAccountInviteEmail } from "@/lib/email";
import { formatEmployeeDisplayName } from "@/lib/employee-names";
import type { AppRole, AppSession } from "@/lib/types";
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

type AuthenticatedUser = {
  id: string;
  email?: string | null;
};

type AccountInviteRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  display_name: string;
  role: AppRole;
  company_id: string;
  site_id: string;
  business_area_id: string;
  schedule_id: string | null;
  employee_id: string | null;
  expires_at: string;
  used_at: string | null;
};

type InviteEmployeeRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  schedule_id: string;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/** Builds the public URL Supabase should send users back to after auth emails. */
async function getAuthRedirectOrigin() {
  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, "");

  if (configuredSiteUrl) {
    return configuredSiteUrl;
  }

  const headerStore = await headers();
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const forwardedHost = headerStore.get("x-forwarded-host");
  const host = headerStore.get("host");
  const requestOrigin = headerStore.get("origin");

  if (requestOrigin) {
    return requestOrigin.replace(/\/+$/, "");
  }

  if (forwardedHost || host) {
    const resolvedHost = forwardedHost ?? host ?? "";
    const resolvedProtocol =
      forwardedProto ?? (resolvedHost.includes("localhost") || resolvedHost.startsWith("127.0.0.1") ? "http" : "https");

    return `${resolvedProtocol}://${resolvedHost}`.replace(/\/+$/, "");
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

async function findActiveInvite(rawToken: string) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      invite: null,
      error: "auth-unavailable" as const,
    };
  }

  const tokenHash = hashInviteToken(rawToken);
  const inviteResult = await supabase
    .from("account_invites")
    .select(
      "id, email, first_name, last_name, display_name, role, company_id, site_id, business_area_id, schedule_id, employee_id, expires_at, used_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteResult.error) {
    return {
      invite: null,
      error: "auth-unavailable" as const,
    };
  }

  const invite = inviteResult.data as AccountInviteRow | null;

  if (!invite) {
    return {
      invite: null,
      error: "invite-invalid" as const,
    };
  }

  if (invite.used_at) {
    return {
      invite: null,
      error: "invite-used" as const,
    };
  }

  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return {
      invite: null,
      error: "invite-expired" as const,
    };
  }

  return {
    invite,
    error: null,
  };
}

async function applyInviteToProfile({
  user,
  invite,
  firstName,
  lastName,
}: {
  user: AuthenticatedUser;
  invite: AccountInviteRow;
  firstName: string;
  lastName: string;
}) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false as const,
      error: "auth-unavailable" as const,
    };
  }

  const displayName =
    `${firstName} ${lastName}`.trim() ||
    invite.display_name ||
    formatEmployeeDisplayName({
      firstName: invite.first_name,
      lastName: invite.last_name,
    }) ||
    user.email?.split("@")[0] ||
    "User";

  const profileUpdate = await supabase
    .from("profiles")
    .update({
      email: user.email?.trim().toLowerCase() ?? invite.email,
      display_name: displayName,
      role: invite.role,
      company_id: invite.company_id,
      site_id: invite.site_id,
      business_area_id: invite.business_area_id,
      schedule_id: invite.schedule_id,
      employee_id: invite.employee_id,
    })
    .eq("id", user.id);

  if (profileUpdate.error) {
    return {
      ok: false as const,
      error: "profile-update-failed" as const,
    };
  }

  const markInviteUsed = await supabase
    .from("account_invites")
    .update({
      used_at: new Date().toISOString(),
      used_by_user_id: user.id,
    })
    .eq("id", invite.id)
    .is("used_at", null);

  if (markInviteUsed.error) {
    return {
      ok: false as const,
      error: "invite-update-failed" as const,
    };
  }

  return {
    ok: true as const,
  };
}

/**
 * Loads the app-specific profile context for an authenticated Supabase user and
 * converts it into the signed workspace session used across the app.
 *
 * Keeping this logic centralized prevents signup and normal sign-in from
 * drifting into slightly different session/bootstrap behavior.
 */
async function establishAppSessionForUser(user: AuthenticatedUser) {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false as const,
      reason: "auth-unavailable" as const,
    };
  }

  const profileResult = await supabase
    .from("profiles")
    .select("email, display_name, role, schedule_id, employee_id, company_id, site_id, business_area_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileResult.error) {
    return {
      ok: false as const,
      reason: "auth-unavailable" as const,
    };
  }

  const profile = profileResult.data as ProfileRow | null;

  if (!profile) {
    return {
      ok: false as const,
      reason: "profile-missing" as const,
    };
  }

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

  return {
    ok: true as const,
    session,
  };
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

  if (!authClient) {
    redirect("/sign-in?error=auth-unavailable");
  }

  const authResult = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (authResult.error || !authResult.data.user) {
    redirect("/sign-in?error=invalid-credentials");
  }

  const sessionResult = await establishAppSessionForUser(authResult.data.user);

  if (!sessionResult.ok) {
    redirect(
      sessionResult.reason === "profile-missing"
        ? "/sign-in?error=profile-missing"
        : "/sign-in?error=auth-unavailable",
    );
  }

  redirect(getSessionHomePath(sessionResult.session));
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
  const inviteToken = String(formData.get("inviteToken") ?? "").trim();

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

  const inviteLookup = inviteToken ? await findActiveInvite(inviteToken) : { invite: null, error: null };

  if (inviteLookup.error) {
    redirect(`/sign-up?error=${inviteLookup.error}&email=${encodeURIComponent(email)}`);
  }

  const invite = inviteLookup.invite;

  if (invite && invite.email.trim().toLowerCase() !== email) {
    redirect(`/sign-up?error=invite-email-mismatch&email=${encodeURIComponent(invite.email)}`);
  }

  const { data, error } = await authClient.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`,
        role: invite?.role ?? "worker",
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

  const createdUser = data.user;

  if (!createdUser) {
    redirect("/sign-in?notice=account-created-sign-in-failed");
  }

  if (invite) {
    const inviteApplyResult = await applyInviteToProfile({
      user: {
        id: createdUser.id,
        email: createdUser.email,
      },
      invite,
      firstName,
      lastName,
    });

    if (!inviteApplyResult.ok) {
      redirect("/sign-in?notice=account-created-pending-access");
    }
  }

  const signInResult = await authClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInResult.error || !signInResult.data.user) {
    const message = signInResult.error?.message.toLowerCase() ?? "";

    if (message.includes("confirm") || message.includes("verified") || message.includes("email")) {
      redirect("/sign-in?notice=account-created-confirm-email");
    }

    redirect("/sign-in?notice=account-created-sign-in-failed");
  }

  const sessionResult = await establishAppSessionForUser(signInResult.data.user);

  if (!sessionResult.ok) {
    redirect(
      sessionResult.reason === "profile-missing"
        ? "/sign-in?notice=account-created-pending-access"
        : "/sign-in?notice=account-created-sign-in-failed",
    );
  }

  redirect(getSessionHomePath(sessionResult.session));
}

export async function createAccountInvite(input: {
  email: string;
  firstName: string;
  lastName: string;
  role: AppRole;
  employeeId?: string | null;
}) {
  const session = await getAppSession();

  if (!session || !["admin", "leader"].includes(session.role)) {
    return {
      ok: false,
      message: "Only admins and leaders can create account invites.",
    };
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const employeeId = input.employeeId?.trim() || null;
  const role = input.role;

  if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
    return {
      ok: false,
      message: "Enter a valid invite email address.",
    };
  }

  if (!firstName || !lastName) {
    return {
      ok: false,
      message: "Enter a first and last name for the invite.",
    };
  }

  if (!["admin", "leader", "worker"].includes(role)) {
    return {
      ok: false,
      message: "Choose a valid app role for the invite.",
    };
  }

  if (session.role === "leader" && role !== "worker") {
    return {
      ok: false,
      message: "Leaders can only create worker invites.",
    };
  }

  if (role !== "admin" && !employeeId) {
    return {
      ok: false,
      message: "Leader and worker invites must be linked to an employee record.",
    };
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return {
      ok: false,
      message: "Supabase is not configured yet. Account invites are unavailable.",
    };
  }

  const [existingProfileResult, employeeResult] = await Promise.all([
    supabase.from("profiles").select("id").eq("email", normalizedEmail).maybeSingle(),
    employeeId
      ? supabase
          .from("employees")
          .select(
            "id, first_name, last_name, email, schedule_id, company_id, site_id, business_area_id",
          )
          .eq("id", employeeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  if (existingProfileResult.error) {
    return {
      ok: false,
      message: "Could not verify whether that email already has an account.",
    };
  }

  if (existingProfileResult.data) {
    return {
      ok: false,
      message: "That email already has an account.",
    };
  }

  const linkedEmployee = employeeResult.data as InviteEmployeeRow | null;

  if (employeeId && (employeeResult.error || !linkedEmployee)) {
    return {
      ok: false,
      message: "Could not load the linked employee for this invite.",
    };
  }

  if (
    linkedEmployee &&
    (linkedEmployee.company_id !== session.companyId ||
      linkedEmployee.site_id !== session.siteId ||
      linkedEmployee.business_area_id !== session.businessAreaId)
  ) {
    return {
      ok: false,
      message: "You can only create invites for employees inside your current scope.",
    };
  }

  if (
    session.role === "leader" &&
    linkedEmployee &&
    session.scheduleId &&
    linkedEmployee.schedule_id !== session.scheduleId
  ) {
    return {
      ok: false,
      message: "Leaders can only create invites for employees on their own shift.",
    };
  }

  const scope = linkedEmployee
    ? {
        companyId: linkedEmployee.company_id,
        siteId: linkedEmployee.site_id,
        businessAreaId: linkedEmployee.business_area_id,
      }
    : {
        companyId: session.companyId,
        siteId: session.siteId,
        businessAreaId: session.businessAreaId,
      };

  if (!scope.companyId || !scope.siteId || !scope.businessAreaId) {
    return {
      ok: false,
      message: "Your profile scope is incomplete. Update it before creating invites.",
    };
  }

  const displayName = formatEmployeeDisplayName({ firstName, lastName });
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashInviteToken(rawToken);

  const inviteInsert = await supabase.from("account_invites").insert({
    token_hash: tokenHash,
    email: normalizedEmail,
    first_name: firstName,
    last_name: lastName,
    display_name: displayName,
    role,
    company_id: scope.companyId,
    site_id: scope.siteId,
    business_area_id: scope.businessAreaId,
    schedule_id: linkedEmployee?.schedule_id ?? null,
    employee_id: linkedEmployee?.id ?? null,
  });

  if (inviteInsert.error) {
    return {
      ok: false,
      message: `Could not create the account invite: ${inviteInsert.error.message}`,
    };
  }

  const inviteUrl = buildCreateAccountInviteUrl(normalizedEmail, rawToken);

  let message = `Invite created for ${displayName}.`;

  try {
    await sendAccountInviteEmail({
      to: normalizedEmail,
      firstName,
      lastName,
      invitedByName: session.displayName,
      inviteToken: rawToken,
      role,
    });
    message = `Invite created and emailed to ${normalizedEmail}.`;
  } catch {
    message = `Invite created for ${displayName}. Copy the link below to share it manually.`;
  }

  return {
    ok: true,
    message,
    inviteUrl,
  };
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
