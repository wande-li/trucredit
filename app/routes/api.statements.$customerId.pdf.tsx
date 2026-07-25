// GET /api/statements/:customerId/pdf — Download customer account statement as PDF
// Requires admin authentication
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { resolveShop } from "~/services/shop-resolver.server";
import { getARAgingByCustomer } from "~/services/invoice.server";
import { getCustomer } from "~/services/customer.server";
import { generateStatementPdf } from "~/services/pdf.server";
import { logger } from "~/services/logger.server";
import prisma from "~/db.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  try {
    // Authenticate admin session
    await authenticate.admin(request);
    const { shopId } = await resolveShop(request);

    const customerId = params.customerId;
    if (!customerId) {
      return new Response("Customer ID is required", { status: 400 });
    }

    // Fetch customer
    const customer = await getCustomer({ shopId, customerId });
    if (!customer) {
      return new Response("Customer not found", { status: 404 });
    }

    // Fetch AR aging data (outstanding invoices + aging buckets)
    const agingData = await getARAgingByCustomer({ shopId, customerId });

    // Fetch shop info for the PDF header
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { shopDomain: true, emailFromName: true, emailReplyTo: true },
    });

    // Generate PDF
    const pdfBuffer = generateStatementPdf({
      customer: {
        name: customer.name,
        company: customer.company,
        email: customer.email,
        creditLimit: customer.creditLimit,
        creditUsed: customer.creditUsed,
        creditAvailable: customer.creditAvailable,
      },
      invoices: agingData.invoices,
      aging: agingData.buckets,
      totalOutstanding: agingData.totalOutstanding,
      totalOverdue: agingData.totalOverdue,
      generatedDate: new Date(),
      shopInfo: {
        name: shop?.emailFromName ?? shop?.shopDomain ?? "TruCredit",
        email: shop?.emailReplyTo ?? undefined,
      },
    });

    // Safe filename: replace any non-alphanumeric chars with underscore
    const safeName = customer.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Statement_${safeName}_${new Date().toISOString().slice(0, 10)}.pdf"`,
        "Content-Length": String(pdfBuffer.byteLength),
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Statement PDF generation failed", msg, { customerId: params.customerId });
    return new Response("Failed to generate statement PDF", { status: 500 });
  }
};

export { ApiErrorBoundary as ErrorBoundary } from "~/components/ApiErrorBoundary";

