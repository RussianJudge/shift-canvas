import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { AppRole, AppSession } from "@/lib/types";

const SESSION_COOKIE = "shift-canvas-session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 14;
const SESSION_SECRET =
  process.env.SHIFT_CANVAS_SESSION_SECRET ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  "shift-canvas-local-session-secret";

type SessionEnvelope = {
  version: 1;
  payload: AppSession;
};

function sign(value: string) {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function encodeSession(session: AppSession) {
  const payload = Buffer.from(
    JSON.stringify({
      version: 1,
      payload: session,
    } satisfies SessionEnvelope),
  ).toString("base64url");

  return `${payload}.${sign(payload)}`;
}

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

    if (decoded.version !== 1) {
      return null;
    }

    return decoded.payload;
  } catch {
    return null;
  }
}

export async function getAppSession() {
  const cookieStore = await cookies();
  return decodeSession(cookieStore.get(SESSION_COOKIE)?.value);
}

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

export async function clearAppSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export function getSessionHomePath(session: AppSession) {
  return session.role === "worker" ? "/profile" : "/schedule";
}

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

export function canManageWorkspace(session: AppSession) {
  return session.role === "admin" || session.role === "leader";
}

export function canManageAdminData(session: AppSession) {
  return session.role === "admin";
}
