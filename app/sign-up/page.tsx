import { redirect } from "next/navigation";

import { SignUpPanel } from "@/components/sign-up-panel";
import { getAppSession, getSessionHomePath } from "@/lib/auth";
import { getDemoAccounts } from "@/lib/demo-users";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const session = await getAppSession();

  if (session) {
    redirect(getSessionHomePath(session));
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return <SignUpPanel accounts={getDemoAccounts()} error={resolvedSearchParams?.error} />;
}
