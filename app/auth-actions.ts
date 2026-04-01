"use server";

import { redirect } from "next/navigation";

import { clearAppSession, setAppSession } from "@/lib/auth";
import { getDemoAccountByEmail } from "@/lib/demo-users";

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

export async function signOut() {
  await clearAppSession();
  redirect("/sign-in");
}
