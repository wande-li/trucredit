// RBAC (Role-Based Access Control) Service
// Guards route loaders/actions with permission checks.
// Integrates with shop-resolver → ResolvedShop.role.

import { ROLE_PERMISSIONS, ROLE_LABELS, type Role, roleLevel } from "~/lib/constants";
import { logger } from "~/services/logger.server";

/** Actions that can be permission-checked */
export type PermissionAction =
  | "view"
  | "edit"
  | "export"
  | "send_email"
  | "manage_collections"
  | "*";

// ── Core permission logic ──

/**
 * Check whether a given role has permission for a specific action.
 * Uses wildcard ("*") support for admin role.
 *
 * @example
 *   checkPermission("manager", "edit")      // true
 *   checkPermission("viewer", "edit")       // false
 *   checkPermission("admin", "anything")    // true (wildcard)
 */
export function checkPermission(userRole: Role, action: PermissionAction): boolean {
  const allowed = ROLE_PERMISSIONS[userRole];
  if (!allowed) return false;
  // admin has wildcard "*"
  if (allowed.includes("*")) return true;
  const result = allowed.includes(action);
  if (!result) {
    logger.app("WARN", "rbac.checkPermission DENIED", null, { role: userRole, action });
  }
  return result;
}

/**
 * Assert that the user has the required permission.
 * Throws a Response (403 Forbidden) if permission is denied.
 *
 * @example
 *   requirePermission("viewer", "edit"); // throws 403
 */
export function requirePermission(role: Role, action: PermissionAction): void {
  if (!checkPermission(role, action)) {
    logger.app("WARN", "Permission denied", {
      role,
      action,
      roleLabel: ROLE_LABELS[role],
    });
    throw new Response(
      JSON.stringify({
        error: "Forbidden",
        message: `Role "${ROLE_LABELS[role]}" does not have permission "${action}".`,
      }),
      {
        status: 403,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

/**
 * Get all available actions for a given role.
 */
export function getAvailableActions(role: Role): string[] {
  const allowed = ROLE_PERMISSIONS[role];
  if (!allowed) return [];
  if (allowed.includes("*")) {
    // Return all known actions except the wildcard itself
    const allActions = new Set<string>();
    for (const [, actions] of Object.entries(ROLE_PERMISSIONS)) {
      for (const a of actions) {
        if (a !== "*") allActions.add(a);
      }
    }
    return Array.from(allActions).sort();
  }
  return [...allowed];
}

/**
 * Check if one role can manage another (higher in hierarchy).
 * Only admins can manage other admins; managers can manage viewers.
 */
export function canManageRole(actorRole: Role, targetRole: Role): boolean {
  return roleLevel(actorRole) > roleLevel(targetRole);
}

/**
 * Get roles that a given role is allowed to assign.
 * e.g. admin can assign [admin, manager, viewer]; manager can assign [viewer].
 */
export function getAssignableRoles(actorRole: Role): Role[] {
  const actorLevel = roleLevel(actorRole);
  // Cannot assign role equal to or above own level
  return (Object.keys(ROLE_LABELS) as Role[]).filter(
    (r) => roleLevel(r) < actorLevel,
  );
}
