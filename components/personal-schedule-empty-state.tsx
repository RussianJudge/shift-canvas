/**
 * Shown when the signed-in account has no employee record behind it.
 *
 * The account is real and the page loaded; there is simply nobody to show a
 * schedule for. Team stays reachable for anyone whose role allows it, so this
 * is never a dead end.
 */
export function PersonalScheduleEmptyState({ canViewTeam }: { canViewTeam: boolean }) {
  return (
    <div className="empty-state personal-empty">
      <strong>Your account is not linked to an employee record.</strong>
      <span>
        Ask an administrator to link it on the Personnel page, and your own shifts will show here.
        {canViewTeam ? " In the meantime, Team shows the full schedule." : ""}
      </span>
    </div>
  );
}
