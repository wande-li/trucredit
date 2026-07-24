// GET /api/invoices/export/csv — Export all invoices as CSV
// Requires admin authentication, exports unfiltered list for current shop
import type { LoaderFunctionArgs } from "@remix-run/node";
import { resolveShop } from "~/services/shop-resolver.server";
import { exportToCsv, csvResponseHeaders } from "~/services/export.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

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
    const { shopId } = await resolveShop(request);

    // Fetch invoices with safety cap (prevent OOM on large shops)
    const invoices = (await prisma.invoice.findMany({
      where: { shopId },
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
      take: 5000,
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

    return new Response(csv, {
      status: 200,
      headers,
    });
  } catch (e: unknown) {
    if (e instanceof Response) {
      // Auth failure in new tab (no session cookie) — show friendly message instead of crashing
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Export</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;color:#333}.box{text-align:center;max-width:420px;padding:2rem}.box h1{font-size:1.25rem;margin:0 0 .5rem}.box p{font-size:.875rem;color:#666;margin:0}</style></head><body><div class="box"><h1>Session expired</h1><p>Please return to the Shopify Admin, navigate to Invoices, and click Export CSV again.</p></div></body></html>`;
      return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Invoice CSV export failed", msg);
    return new Response("Failed to export invoices", { status: 500 });
  }
};
