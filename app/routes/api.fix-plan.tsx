import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "~/db.server";

// One-time fix endpoint — will be removed after execution
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  // Simple protection
  if (token !== "trucredit-fix-2026") {
    return json({ error: "Invalid token" }, 401);
  }

  const shops = await prisma.shop.findMany({
    select: { shopDomain: true, plan: true, subscriptionStatus: true },
  });

  const fixResult = await prisma.shop.updateMany({
    where: { shopDomain: "ai-pilot-dev.myshopify.com" },
    data: { plan: "STARTER", subscriptionStatus: "ACTIVE" },
  });

  return json({
    before: shops,
    fixResult,
    message: "Done",
  });
};
