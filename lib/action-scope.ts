import type { AppSession } from "@/lib/types";

export type ActionScope = { companyId: string; siteId: string; businessAreaId: string };

/**
 * The organization boundary a mutation is allowed to cross.
 *
 * All database access uses the service-role client, which bypasses RLS, so this
 * is the tenant boundary rather than a second line of defence. It mirrors the
 * read path in `applySessionScope`: an admin is bounded by their company, and
 * everyone else by their own site and business area.
 *
 * It lives in `lib/` because two entry points need the same answer. The invite
 * path once had its own copy that compared an admin against their home site and
 * business area, which refused invites for anyone in a business area the admin
 * did not personally belong to while still letting them edit those same people.
 */
export function canAccessScope(session: AppSession | null | undefined, scope: ActionScope) {
  if (!session?.companyId) {
    return false;
  }

  if (session.role === "admin") {
    return session.companyId === scope.companyId;
  }

  return (
    session.companyId === scope.companyId &&
    session.siteId === scope.siteId &&
    session.businessAreaId === scope.businessAreaId
  );
}
