// GET /api/customers/export/csv — Export all customers as CSV
// Requires admin authentication, exports unfiltered list for current shop
import type { LoaderFunctionArgs } from "@remix-run/node";
import { resolveShop } from "~/services/shop-resolver.server";
import { exportToCsv, csvResponseHeaders } from "~/services/export.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

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
  try {
    const { shopId } = await resolveShop(request);

    // Fetch customers with safety cap (prevent OOM on large shops)
    const customers = (await prisma.customer.findMany({
      where: { shopId },
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
      take: 5000,
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

    return new Response(csv, {
      status: 200,
      headers,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Customer CSV export failed", msg);
    return new Response("Failed to export customers", { status: 500 });
  }
};
