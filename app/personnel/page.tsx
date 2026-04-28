import { Suspense } from "react";

import { PersonnelPanel } from "@/components/personnel-panel";
import { LoadingPanelFrame, LoadingTable, LoadingToolbarFields } from "@/components/workspace-loading";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireAppSession } from "@/lib/auth";
import { getPersonnelSnapshot } from "@/lib/data";
import { formatMonthLabel, getCurrentMonthKey } from "@/lib/scheduling";

export const dynamic = "force-dynamic";

async function PersonnelBoard({
  session,
  month,
}: {
  session: Awaited<ReturnType<typeof requireAppSession>>;
  month: string;
}) {
  const snapshot = await getPersonnelSnapshot(month, session);
  return <PersonnelPanel snapshot={snapshot} />;
}

function PersonnelBoardFallback({ month }: { month: string }) {
  return (
    <LoadingPanelFrame
      title="Personnel"
      toolbar={
        <LoadingToolbarFields
          className="workspace-toolbar workspace-toolbar--personnel-page"
          fields={[
            { label: "Month", value: formatMonthLabel(month) },
            { label: "Rows", value: "Loading roster..." },
            { label: "Scope", value: "Loading workspace..." },
          ]}
        />
      }
    >
      <LoadingTable columns={["First name", "Last name", "Email", "Role", "Shift", "Actions"]} rows={6} />
    </LoadingPanelFrame>
  );
}

export default async function PersonnelPage() {
  const session = await requireAppSession(["admin", "leader"]);
  const month = getCurrentMonthKey("America/Edmonton");

  return (
    <WorkspaceShell viewer={session}>
      <Suspense key={month} fallback={<PersonnelBoardFallback month={month} />}>
        <PersonnelBoard session={session} month={month} />
      </Suspense>
    </WorkspaceShell>
  );
}
