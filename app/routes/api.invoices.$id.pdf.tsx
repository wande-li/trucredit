// GET /api/invoices/:id/pdf — Download invoice as PDF
// Requires admin authentication
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { resolveShop } from "~/services/shop-resolver.server";
import { getInvoice } from "~/services/invoice.server";
import { generateInvoicePdf } from "~/services/pdf.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const t0 = Date.now();
  logger.app("INFO", "loader:api.invoices.$id.pdf START", null, { invoiceId: params.id });
  try {
    // Authenticate admin session
    await authenticate.admin(request);
    const { shopId } = await resolveShop(request);

    const invoiceId = params.id;
    if (!invoiceId) {
      return new Response("Invoice ID is required", { status: 400 });
    }

    // Fetch invoice
    const invoice = await getInvoice({ shopId, invoiceId });
    if (!invoice) {
      return new Response("Invoice not found", { status: 404 });
    }

    // Fetch customer info
    const customer = await prisma.customer.findUnique({
      where: { id: invoice.customerId },
      select: { name: true, company: true, email: true },
    });

    if (!customer) {
      return new Response("Customer not found", { status: 404 });
    }

    // Fetch shop info for the PDF header
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, emailFromName: true, emailReplyTo: true },
    });

    // Generate PDF
    const pdfBuffer = generateInvoicePdf({
      invoice,
      customer,
      shopInfo: {
        name: shop?.emailFromName ?? shop?.shopDomain ?? "TruCredit",
        email: shop?.emailReplyTo ?? undefined,
      },
    });

    logger.app("INFO", "loader:api.invoices.$id.pdf OK", null, {
      durationMs: Date.now() - t0,
      invoiceId: params.id,
      pdfSize: pdfBuffer.byteLength,
    });
    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${invoice.invoiceNumber}.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "loader:api.invoices.$id.pdf ERROR", msg, { durationMs: Date.now() - t0, invoiceId: params.id });
    return new Response("Failed to generate PDF", { status: 500 });
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

