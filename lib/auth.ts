import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

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
  return decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
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
