import { MutualsPanel } from "@/components/mutuals-panel";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getMutualsSnapshot } from "@/lib/data";
import { getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

export default async function MutualsPage({
  searchParams,
}: {
  searchParams?: Promise<{ month?: string }>;
}) {
  const session = await requireAppSession(["admin", "leader", "worker"]);
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const currentMonth = getCurrentMonthKey("America/Edmonton");
  const month =
    resolvedSearchParams?.month && /^\d{4}-\d{2}$/.test(resolvedSearchParams.month)
      ? resolvedSearchParams.month
      : currentMonth;
  const snapshot = await getMutualsSnapshot(month);

  return (
    <WorkspaceShell viewer={session}>
      <MutualsPanel snapshot={snapshot} viewer={session} />
    </WorkspaceShell>
  );
}
