import { PatLeaveNotice } from "@/components/pat-leave-notice";
import { getAppSession, getSessionHomePath } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getAppSession();

  return (
    <PatLeaveNotice
      eyebrow="Out of office"
      title="Schwifty is off on pat leave."
      actionHref={session ? getSessionHomePath() : "/sign-in"}
      actionLabel={session ? "Open workspace anyway" : "Log in anyway"}
    />
  );
}
