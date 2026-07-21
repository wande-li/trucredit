// TruCredit — Shopify Native Invoice Ordering Service
// Creates draft orders + sends invoices via Shopify Admin GraphQL API.
// Designed for worker context (no Remix request) — uses direct fetch with access token.
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";
import {
  DRAFT_ORDER_CREATE,
  DRAFT_ORDER_INVOICE_SEND,
  ORDER_INVOICE_SEND,
  PAYMENT_TERMS_CREATE,
  GET_PAYMENT_TERMS_TEMPLATES,
} from "~/lib/graphql-queries";
import { decryptToken } from "~/lib/crypto.server";

interface GraphQLResult<T = unknown> {
  data?: T;
  errors?: Array<{ message: string }>;
}

interface DraftOrderCreateResult {
  draftOrderCreate?: {
    draftOrder?: { id: string };
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface DraftOrderInvoiceSendResult {
  draftOrderInvoiceSend?: {
    draftOrder?: { id: string };
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface OrderInvoiceSendResult {
  orderInvoiceSend?: {
    order?: { id: string };
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface PaymentTermsCreateResult {
  purchaseOrderPaymentTermsCreate?: {
    paymentTerms?: { id: string };
    userErrors: Array<{ field: string; message: string }>;
  };
}

interface PaymentTermsTemplatesResult {
  purchaseOrderPaymentTermsTemplates?: {
    edges: Array<{
      node: { id: string; name: string; dueInDays: number; description: string };
    }>;
  };
}

const API_VERSION = "2025-10";

/**
 * Raw Shopify Admin GraphQL call using direct fetch (works outside Remix request context).
 */
async function shopifyGraphQL<T = unknown>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<GraphQLResult<T>> {
  const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify GraphQL ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<GraphQLResult<T>>;
}

/**
 * Get the shop's decrypted access token. Returns null if not found.
 */
async function getShopToken(shopId: string): Promise<{ token: string; domain: string } | null> {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    select: { shopDomain: true, accessToken: true },
  });
  if (!shop || !shop.accessToken) return null;
  const token = await decryptToken(shop.accessToken);
  return { token, domain: shop.shopDomain };
}

/**
 * Get the default payment terms template (Net 7 for collection draft orders).
 */
async function getDefaultPaymentTermsTemplateId(
  shopDomain: string,
  accessToken: string,
): Promise<string | null> {
  try {
    const result = await shopifyGraphQL<PaymentTermsTemplatesResult>(
      shopDomain,
      accessToken,
      GET_PAYMENT_TERMS_TEMPLATES,
      {},
    );

    const templates = result.data?.purchaseOrderPaymentTermsTemplates?.edges ?? [];
    // Prefer Net 7, then Net 10, then first available
    for (const tpl of templates) {
      if (tpl.node.dueInDays === 7) return tpl.node.id;
    }
    for (const tpl of templates) {
      if (tpl.node.dueInDays === 10) return tpl.node.id;
    }
    return templates[0]?.node.id ?? null;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("WARN", "Failed to get payment terms templates", msg);
    return null;
  }
}

/**
 * Create a Shopify Draft Order for overdue invoice collection.
 * Used by the collection worker to offer Shopify-native payment link.
 *
 * @returns { draftOrderId: string | null; invoiceUrl: string | null }
 */
export async function createCollectionDraftOrder(args: {
  shopId: string;
  customerId: string;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  customerEmail: string;
  shopifyCustomerId: string;
}): Promise<{ draftOrderId: string | null; invoiceUrl: string | null }> {
  const { shopId, customerId, invoiceId, invoiceNumber, amount, currency, customerEmail, shopifyCustomerId } = args;

  // Get shop access token
  const shopToken = await getShopToken(shopId);
  if (!shopToken) {
    logger.app("WARN", "Collection draft order: no shop token", undefined, { shopId, invoiceId });
    return { draftOrderId: null, invoiceUrl: null };
  }

  const { token, domain } = shopToken;

  try {
    // 1. Create draft order
    const draftResult = await shopifyGraphQL<DraftOrderCreateResult>(
      domain,
      token,
      DRAFT_ORDER_CREATE,
      {
        input: {
          note: `TruCredit Collection — Invoice #${invoiceNumber}`,
          email: customerEmail,
          lineItems: [
            {
              title: `Outstanding Payment — Invoice #${invoiceNumber}`,
              originalUnitPrice: amount.toFixed(2),
              quantity: 1,
              requiresShipping: false,
            },
          ],
          customerId: shopifyCustomerId.startsWith("gid://")
            ? shopifyCustomerId
            : `gid://shopify/Customer/${shopifyCustomerId}`,
        },
      },
    );

    const userErrors = draftResult.data?.draftOrderCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      logger.app("WARN", "Draft order creation failed with user errors", undefined, {
        shopId,
        invoiceId,
        errors: userErrors.map(e => e.message),
      });
      return { draftOrderId: null, invoiceUrl: null };
    }

    const draftOrderGid = draftResult.data?.draftOrderCreate?.draftOrder?.id;
    if (!draftOrderGid) {
      logger.app("WARN", "Draft order creation returned no ID", undefined, { shopId, invoiceId });
      return { draftOrderId: null, invoiceUrl: null };
    }

    // 2. Apply payment terms (Net 7 default) to the draft order
    try {
      const templateId = await getDefaultPaymentTermsTemplateId(domain, token);
      if (templateId) {
        await shopifyGraphQL<PaymentTermsCreateResult>(domain, token, PAYMENT_TERMS_CREATE, {
          referenceId: draftOrderGid,
          paymentTermsTemplateId: templateId,
        });
      } else {
        // Fallback: create payment terms inline with dueInDays=7
        await shopifyGraphQL<PaymentTermsCreateResult>(domain, token, PAYMENT_TERMS_CREATE, {
          referenceId: draftOrderGid,
          paymentTermsAttributes: {
            dueInDays: 7,
            paymentTermsType: "NET",
          },
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Payment terms apply failed on draft order", msg, { draftOrderGid });
      // Continue — draft order is still valid without payment terms
    }

    // 3. Send invoice email
    const invoiceResult = await shopifyGraphQL<DraftOrderInvoiceSendResult>(
      domain,
      token,
      DRAFT_ORDER_INVOICE_SEND,
      { id: draftOrderGid, sendEmail: true },
    );

    const invoiceErrors = invoiceResult.data?.draftOrderInvoiceSend?.userErrors ?? [];
    if (invoiceErrors.length > 0) {
      logger.app("WARN", "Draft order invoice send failed", undefined, {
        shopId,
        invoiceId,
        draftOrderGid,
        errors: invoiceErrors.map(e => e.message),
      });
      // Draft order created but invoice not sent — partial success
      return { draftOrderId: draftOrderGid, invoiceUrl: null };
    }

    // 4. Record CollectionEvent via emailBody (no actionTaken field on schema)
    try {
      const task = await prisma.collectionTask.findFirst({
        where: { invoiceId, status: "ACTIVE" },
        select: { id: true },
      });
      if (task) {
        await prisma.collectionEvent.create({
          data: {
            taskId: task.id,
            type: "EMAIL_SENT",
            channel: "EMAIL",
            stepOrder: 99,
            toneLevel: 3,
            aiGenerated: false,
            emailBody: JSON.stringify({
              source: "shopify_draft_order",
              draftOrderGid,
              action: "invoice_sent_for_collection",
            }),
          },
        });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.app("WARN", "Failed to record collection event for draft order", msg, { draftOrderGid });
    }

    logger.app("INFO", "Collection draft order created + invoice sent", undefined, {
      shopId,
      invoiceId,
      draftOrderGid,
    });

    return { draftOrderId: draftOrderGid, invoiceUrl: null };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Collection draft order creation failed", msg, {
      shopId,
      invoiceId,
    });
    return { draftOrderId: null, invoiceUrl: null };
  }
}

/**
 * Send Shopify-native invoice for an existing order (not draft).
 * Used for one-off invoice resends from the admin UI.
 */
export async function sendOrderInvoice(args: {
  shopId: string;
  orderGid: string;
}): Promise<boolean> {
  const { shopId, orderGid } = args;
  const shopToken = await getShopToken(shopId);
  if (!shopToken) return false;

  try {
    const result = await shopifyGraphQL<OrderInvoiceSendResult>(
      shopToken.domain,
      shopToken.token,
      ORDER_INVOICE_SEND,
      { id: orderGid },
    );

    const errors = result.data?.orderInvoiceSend?.userErrors ?? [];
    if (errors.length > 0) {
      logger.app("WARN", "Order invoice send failed", undefined, { orderGid, errors: errors.map(e => e.message) });
      return false;
    }

    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Order invoice send exception", msg, { orderGid });
    return false;
  }
}
