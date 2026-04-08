import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSupabaseAdminClient } from "@/lib/supabase";
import type { AppRole, AppSession } from "@/lib/types";

/**
 * Lightweight signed-cookie session layer for the app.
 *
 * The product does not yet use a full hosted auth session in the UI, so we
 * persist the already-resolved application profile (role, linked schedule, and
 * worker id) inside an HMAC-signed cookie. Server pages and actions can then
 * read one object and make authorization decisions without repeating profile
 * lookups on every request.
 */
const SESSION_COOKIE = "shift-canvas-session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;
const SESSION_SECRET =
  process.env.SHIFT_CANVAS_SESSION_SECRET ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "shift-canvas-local-session-secret";

type SessionEnvelope = {
  version: 2;
  payload: AppSession;
};

type ProfileSessionRow = {
  email: string;
  display_name: string;
  role: AppRole;
  schedule_id: string | null;
  employee_id: string | null;
  company_id: string;
  site_id: string;
  business_area_id: string;
};

type NamedScopeRow = {
  id: string;
  name: string;
};

type ScheduleNameRow = {
  id: string;
  name: string;
};

/** Produces the signature used to detect tampering on the stored session cookie. */
function sign(value: string) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

/** Serializes and signs the complete app session payload for cookie storage. */
function encodeSession(session: AppSession) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 2,
      payload: session,
    } satisfies SessionEnvelope),
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

/** Verifies the HMAC signature and returns a trusted session payload. */
function decodeSession(value: string | undefined): AppSession | null {
  if (!value) {
    return null;
  }

  const [payload, signature] = value.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expectedSignature = sign(payload);
  const isValid =
    signature.length === expectedSignature.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  if (!isValid) {
    return null;
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionEnvelope;

    if (decoded.version !== 2) {
      return null;
    }

    const session = decoded.payload;

    if (
      !session ||
      typeof session.email !== "string" ||
      typeof session.role !== "string" ||
      typeof session.displayName !== "string" ||
      typeof session.companyId !== "string" ||
      typeof session.siteId !== "string" ||
      typeof session.businessAreaId !== "string" ||
      typeof session.companyName !== "string" ||
      typeof session.siteName !== "string" ||
      typeof session.businessAreaName !== "string"
    ) {
      return null;
    }

    if (
      ("activeSiteId" in session && session.activeSiteId !== null && typeof session.activeSiteId !== "string") ||
      ("activeBusinessAreaId" in session &&
        session.activeBusinessAreaId !== null &&
        typeof session.activeBusinessAreaId !== "string")
    ) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}

/** Reads the current signed session cookie, if one exists. */
export async function getAppSession() {
  const cookieStore = await cookies();
  const cookieSession = decodeSession(cookieStore.get(SESSION_COOKIE)?.value);

  if (!cookieSession) {
    return null;
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return cookieSession;
  }

  /**
   * Refreshes the effective app session from `public.profiles`.
   *
   * The signed cookie is still useful as a fast identity snapshot, but profile
   * rows can change outside the app (for example, an admin updates a role or
   * business area in Supabase). Re-hydrating here makes those changes take
   * effect on the next request instead of leaving the browser trapped behind a
   * stale cookie until the user manually signs out.
   */
  const profileResult = await supabase
    .from("profiles")
    .select("email, display_name, role, schedule_id, employee_id, company_id, site_id, business_area_id")
    .eq("email", cookieSession.email)
    .maybeSingle();

  if (profileResult.error) {
    return cookieSession;
  }

  const profile = profileResult.data as ProfileSessionRow | null;

  if (!profile) {
    return null;
  }

  let scheduleName = cookieSession.scheduleName ?? null;
  let companyName = cookieSession.companyName;
  let siteName = cookieSession.siteName;
  let businessAreaName = cookieSession.businessAreaName;

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
    scheduleName = (scheduleResult.data as ScheduleNameRow | null)?.name ?? null;
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

  return {
    ...cookieSession,
    role: profile.role,
    displayName: profile.display_name || profile.email.split("@")[0] || cookieSession.displayName,
    scheduleId: profile.schedule_id,
    employeeId: profile.employee_id,
    scheduleName,
    companyId: profile.company_id,
    siteId: profile.site_id,
    businessAreaId: profile.business_area_id,
    companyName,
    siteName,
    businessAreaName,
    activeSiteId: profile.role === "admin" ? cookieSession.activeSiteId ?? null : profile.site_id,
    activeBusinessAreaId:
      profile.role === "admin" ? cookieSession.activeBusinessAreaId ?? null : profile.business_area_id,
  };
}

/** Writes a fresh signed session cookie after sign-in. */
export async function setAppSession(session: AppSession) {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE, encodeSession(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DURATION_SECONDS,
  });
}

/** Clears the session cookie during sign-out. */
export async function clearAppSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** Chooses the first page a role should see after authentication. */
export function getSessionHomePath(session: AppSession) {
  return session.role === "worker" ? "/profile" : "/schedule";
}

/** Guards a server route and redirects users who are missing or under-scoped. */
export async function requireAppSession(allowedRoles?: AppRole[]) {
  const session = await getAppSession();

  if (!session) {
    redirect("/sign-in");
  }

  if (allowedRoles && !allowedRoles.includes(session.role)) {
    redirect(getSessionHomePath(session));
  }

  return session;
}

/** Shared role helper for pages/actions that can edit scheduling data. */
export function canManageWorkspace(session: AppSession) {
  return session.role === "admin" || session.role === "leader";
}

/** Shared role helper for admin-only reference data pages. */
export function canManageAdminData(session: AppSession) {
  return session.role === "admin";
}
