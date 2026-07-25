// GET /api/customers/export/csv — Export all customers as CSV
// Uses fetch()+JWT auth (App Bridge), NOT window.open() — no ?shop= param needed
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { exportToCsv, csvResponseHeaders } from "~/services/export.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";
import { EXPORT_MAX_ROWS } from "~/lib/constants";

const CSV_HEADERS = [
  "Company",
  "Contact",
  "Email",
  "Credit Limit",
  "Balance",
  "Status",
] as const;

type ExportRow = {
  name: string;
  company: string | null;
  email: string;
  creditLimit: { toString(): string };
  creditAvailable: { toString(): string };
  status: string;
  isFrozen: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:api.customers.export.csv START");
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) return new Response("Store not found.", { status: 404 });

    // Fetch customers with safety cap (prevent OOM on large shops)
    const customers = (await prisma.customer.findMany({
      where: { shopId: shop.id },
      select: {
        name: true,
        company: true,
        email: true,
        creditLimit: true,
        creditAvailable: true,
        status: true,
        isFrozen: true,
      },
      orderBy: { updatedAt: "desc" },
      take: EXPORT_MAX_ROWS,
    })) as ExportRow[];

    // Build CSV rows
    const rows: string[][] = customers.map((c) => {
      const displayStatus = c.isFrozen ? "FROZEN" : c.status;
      return [
        c.company ?? c.name,
        c.name,
        c.email,
        Number(c.creditLimit).toFixed(2),
        Number(c.creditAvailable).toFixed(2),
        displayStatus,
      ];
    });

    const csv = exportToCsv([...CSV_HEADERS], rows);
    const headers = csvResponseHeaders("customers-export");

    logger.app("INFO", "loader:api.customers.export.csv OK", null, {
      durationMs: Date.now() - t0,
      rowCount: rows.length,
    });
    return new Response(csv, { status: 200, headers });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:api.customers.export.csv ERROR", msg, { durationMs: Date.now() - t0 });
    return new Response("Failed to export customers", { status: 500 });
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

