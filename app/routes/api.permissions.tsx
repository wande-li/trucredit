// API: GET /api/permissions — returns current user's role and permission list
// Used by the frontend to conditionally render UI elements based on permissions.

import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { resolveShop } from "~/services/shop-resolver.server";
import { getAvailableActions } from "~/services/rbac.server";
import { ROLE_LABELS, type Role } from "~/lib/constants";
import { logger } from "~/services/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:api.permissions START");
  try {
    const { role } = await resolveShop(request);

    logger.app("INFO", "loader:api.permissions OK", null, { durationMs: Date.now() - t0, role });
    return json({
      role,
      roleLabel: ROLE_LABELS[role],
      permissions: getAvailableActions(role),
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:api.permissions ERROR", msg, { durationMs: Date.now() - t0 });
    return json(
      {
        role: "viewer" as Role,
        roleLabel: "Viewer",
        permissions: ["view"],
        error: "Unable to verify your access. View-only mode enabled.",
      },
      { status: 200 }, // Don't block the UI — degrade gracefully
    );
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

