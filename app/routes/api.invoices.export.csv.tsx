// GET /api/invoices/export/csv — Export all invoices as CSV
// Requires admin authentication, exports unfiltered list for current shop
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
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
    // Authenticate admin session
    await authenticate.admin(request);
    const { shopId } = await resolveShop(request);

    // Fetch all invoices for the shop (unpaginated — full export)
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
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Invoice CSV export failed", msg);
    return new Response("Failed to export invoices", { status: 500 });
  }
};
