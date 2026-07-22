// Cancel subscription — calls Shopify GraphQL appSubscriptionCancel
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { logger } from "~/services/logger.server";

const APP_SUBSCRIPTION_CANCEL_MUTATION = `#graphql
  mutation AppSubscriptionCancel($id: ID!) {
    appSubscriptionCancel(id: $id) {
      userErrors {
        field
        message
      }
      appSubscription {
        id
        status
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopDomain = session.shop.trim();

  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { plan: true, shopifyChargeId: true },
  });

  if (!shop) {
    return json({ error: "Shop not found." }, { status: 404 });
  }

  if (!shop.shopifyChargeId) {
    return json({ error: "No active subscription found." }, { status: 400 });
  }

  // shopifyChargeId stores the numeric charge ID (e.g. "27663859800").
  // Shopify GraphQL requires gid://shopify/AppSubscription/{id} format.
  const gid = `gid://shopify/AppSubscription/${shop.shopifyChargeId}`;

  logger.app("INFO", "Cancelling subscription", {
    shopDomain,
    chargeId: shop.shopifyChargeId,
    gid,
  });

  try {
    const response = await admin.graphql(APP_SUBSCRIPTION_CANCEL_MUTATION, {
      variables: { id: gid },
    });

    const result = await response.json();
    const userErrors = result?.data?.appSubscriptionCancel?.userErrors ?? [];

    if (userErrors.length > 0) {
      const messages = userErrors
        .map((e: { field: string[]; message: string }) =>
          `${e.field.join(".")}: ${e.message}`
        )
        .join("; ");
      logger.app("ERROR", "appSubscriptionCancel userErrors", {
        shopDomain,
        chargeId: shop.shopifyChargeId,
        userErrors: messages,
      });
      return json({ error: messages }, { status: 422 });
    }

    const newStatus =
      result?.data?.appSubscriptionCancel?.appSubscription?.status ??
      "CANCELLED";
    logger.app("INFO", "Subscription cancelled successfully", {
      shopDomain,
      gid,
      newStatus,
    });

    return json({ success: true, status: newStatus });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "Cancel subscription GraphQL call failed", {
      shopDomain,
      error: msg,
    });
    return json(
      {
        error:
          "Failed to cancel subscription. Please try again or contact support.",
      },
      { status: 500 },
    );
  }
};
