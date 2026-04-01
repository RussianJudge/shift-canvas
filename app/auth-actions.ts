"use server";

import { redirect } from "next/navigation";

import { clearAppSession, setAppSession } from "@/lib/auth";
import { buildDemoSession, getDemoAccountByEmail } from "@/lib/demo-users";
import type { AppRole } from "@/lib/types";

function isAppRole(value: FormDataEntryValue | null): value is AppRole {
  return value === "admin" || value === "leader" || value === "worker";
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    redirect("/sign-in?error=missing-email");
  }

  const account = getDemoAccountByEmail(email);

  if (!account) {
    redirect("/sign-in?error=unknown-email");
  }

  await setAppSession(account);
  redirect("/schedule");
}

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = formData.get("role");

  if (!email) {
    redirect("/sign-up?error=missing-email");
  }

  if (!isAppRole(role)) {
    redirect("/sign-up?error=invalid-role");
  }

  const session = buildDemoSession(email, role);

  if (!session) {
    redirect("/sign-up?error=invalid-role");
  }

  await setAppSession(session);
  redirect("/schedule");
}

export async function signOut() {
  await clearAppSession();
  redirect("/sign-in");
}
