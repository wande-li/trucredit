// GET /api/invoices/export/csv — Export all invoices as CSV
// Uses fetch()+JWT auth (App Bridge), NOT window.open() — no ?shop= param needed
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { exportToCsv, csvResponseHeaders } from "~/services/export.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";
import { EXPORT_MAX_ROWS } from "~/lib/constants";

const CSV_HEADERS = [
  "Invoice #",
  "Customer",
  "Amount",
  "Status",
  "Due Date",
  "Created",
] as const;

const STATUS_LABEL: Record<string, string> = {
  PAID: "Paid",
  OVERDUE: "Overdue",
  DISPUTED: "Disputed",
  PARTIALLY_PAID: "Partially Paid",
  DRAFT: "Draft",
  PENDING: "Pending",
  VOID: "Void",
};

type ExportRow = {
  invoiceNumber: string;
  amount: { toString(): string };
  currency: string;
  status: string;
  dueDate: Date;
  createdAt: Date;
  customer: { name: string; company: string | null };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });
    if (!shop) return new Response("Store not found.", { status: 404 });

    // Fetch invoices with safety cap (prevent OOM on large shops)
    const invoices = (await prisma.invoice.findMany({
      where: { shopId: shop.id },
      select: {
        invoiceNumber: true,
        amount: true,
        currency: true,
        status: true,
        dueDate: true,
        createdAt: true,
        customer: { select: { name: true, company: true } },
      },
      orderBy: { createdAt: "desc" },
      take: EXPORT_MAX_ROWS,
    })) as ExportRow[];

    // Build CSV rows
    const rows: string[][] = invoices.map((inv) => [
      inv.invoiceNumber,
      inv.customer.company ?? inv.customer.name,
      `${inv.currency} ${Number(inv.amount).toFixed(2)}`,
      STATUS_LABEL[inv.status] ?? inv.status,
      inv.dueDate.toISOString().split("T")[0] ?? "",
      inv.createdAt.toISOString().split("T")[0] ?? "",
    ]);

    const csv = exportToCsv([...CSV_HEADERS], rows);
    const headers = csvResponseHeaders("invoices-export");

    return new Response(csv, { status: 200, headers });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Invoice CSV export failed", msg);
    return new Response("Failed to export invoices", { status: 500 });
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

