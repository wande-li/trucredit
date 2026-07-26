import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { resolveShop } from "~/services/shop-resolver.server";
import { checkPlanAccess } from "~/services/billing.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";

/**
 * Team Members API — CRUD for RBAC role assignments.
 * 
 * Intents:
 *   - add-team-member: { email, role }
 *   - update-team-member: { memberId, role }
 *   - remove-team-member: { memberId }
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const ta = Date.now();
  logger.app("INFO", "action:api.team-members START");
  try {
    const { shopId, role: callerRole } = await resolveShop(request);
    
    // Plan gate: team management requires a paid plan
    const { isPaid } = await checkPlanAccess(shopId);
    if (!isPaid) {
      logger.app("WARN", "action:api.team-members plan_gate blocked", null, { shopId });
      return json({ error: "Team management requires a paid plan. Please upgrade." }, { status: 402 });
    }
    
    // Only admins can manage team members
    if (callerRole !== "admin") {
      return json({ error: "Only admins can manage team members" }, { status: 403 });
    }

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    switch (intent) {
      case "add-team-member": {
        const email = formData.get("email")?.toString()?.trim().toLowerCase();
        const role = formData.get("role")?.toString();

        if (!email || !role) {
          return json({ error: "Email and role are required" }, { status: 400 });
        }
        if (!["admin", "manager", "viewer"].includes(role)) {
          return json({ error: "Please select a valid role." }, { status: 400 });
        }
        if (!email.includes("@")) {
          return json({ error: "Please enter a valid email address." }, { status: 400 });
        }

        // Check if already a member
        const existing = await prisma.teamMember.findUnique({
          where: { shopId_email: { shopId, email } },
        });
        if (existing) {
          return json({ error: "This email is already a team member" }, { status: 409 });
        }

        const member = await prisma.teamMember.create({
          data: { shopId, email, role },
          select: { id: true, email: true, role: true, assignedAt: true },
        });

        logger.app("INFO", "action:api.team-members add OK", null, { durationMs: Date.now() - ta, email, role });
        return json({ success: true, member });
      }

      case "update-team-member": {
        const memberId = formData.get("memberId")?.toString();
        const role = formData.get("role")?.toString();

        if (!memberId || !role) {
          return json({ error: "Member ID and role are required" }, { status: 400 });
        }
        if (!["admin", "manager", "viewer"].includes(role)) {
          return json({ error: "Please select a valid role." }, { status: 400 });
        }

        const member = await prisma.teamMember.findFirst({
          where: { id: memberId, shopId },
        });
        if (!member) {
          return json({ error: "Team member not found" }, { status: 404 });
        }

        const updated = await prisma.teamMember.update({
          where: { id: memberId },
          data: { role },
          select: { id: true, email: true, role: true, updatedAt: true },
        });

        logger.app("INFO", "action:api.team-members update OK", null, { durationMs: Date.now() - ta, email: updated.email, role });
        return json({ success: true, member: updated });
      }

      case "remove-team-member": {
        const memberId = formData.get("memberId")?.toString();

        if (!memberId) {
          return json({ error: "Member ID is required" }, { status: 400 });
        }

        const member = await prisma.teamMember.findFirst({
          where: { id: memberId, shopId },
        });
        if (!member) {
          return json({ error: "Team member not found" }, { status: 404 });
        }

        await prisma.teamMember.delete({ where: { id: memberId } });

        logger.app("INFO", "action:api.team-members remove OK", null, { durationMs: Date.now() - ta, email: member.email });
        return json({ success: true });
      }

      default:
        logger.app("WARN", "action:api.team-members unknown_intent", null, { intent });
        return json({ error: "Something went wrong. Please try again." }, { status: 400 });
    }
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "action:api.team-members ERROR", msg, { durationMs: Date.now() - ta });
    return json({ error: msg }, { status: 500 });
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

