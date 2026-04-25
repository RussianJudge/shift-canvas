import { redirect } from "next/navigation";

import { SignInPanel } from "@/components/sign-in-panel";
import { getAppSession, getSessionHomePath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string; notice?: string; email?: string }>;
}) {
  const session = await getAppSession();

  if (session) {
    redirect(getSessionHomePath(session));
  }

  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <SignInPanel
      error={resolvedSearchParams?.error}
      notice={resolvedSearchParams?.notice}
      initialEmail={resolvedSearchParams?.email}
      initialMode="create"
    />
  );
}
