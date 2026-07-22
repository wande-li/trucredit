// API endpoint for Shopify charge creation
// Uses admin.graphql() directly to bypass SDK billing layer and get detailed errors
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '~/shopify.server';
import {
  PLAN_STARTER_MONTHLY,
  PLAN_STARTER_ANNUAL,
  PLAN_PRO_MONTHLY,
  PLAN_PRO_ANNUAL,
  PLAN_ENTERPRISE_MONTHLY,
  PLAN_ENTERPRISE_ANNUAL,
} from '~/shopify.server';
import { PLANS } from '~/services/billing.server';
import { logger } from '~/services/logger.server';

// Plan name → pricing lookup (mirrors shopify.server.ts billing config)
const PLAN_PRICING: Record<string, { amount: number; interval: 'EVERY_30_DAYS' | 'ANNUAL'; trialDays: number }> = {
  [PLAN_STARTER_MONTHLY]: { amount: 29.0, interval: 'EVERY_30_DAYS', trialDays: 14 },
  [PLAN_STARTER_ANNUAL]: { amount: 290.0, interval: 'ANNUAL', trialDays: 14 },
  [PLAN_PRO_MONTHLY]: { amount: 79.0, interval: 'EVERY_30_DAYS', trialDays: 14 },
  [PLAN_PRO_ANNUAL]: { amount: 790.0, interval: 'ANNUAL', trialDays: 14 },
  [PLAN_ENTERPRISE_MONTHLY]: { amount: 149.0, interval: 'EVERY_30_DAYS', trialDays: 14 },
  [PLAN_ENTERPRISE_ANNUAL]: { amount: 1490.0, interval: 'ANNUAL', trialDays: 14 },
};

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!,
    $returnUrl: URL!,
    $lineItems: [AppSubscriptionLineItemInput!]!,
    $test: Boolean!,
    $trialDays: Int!
  ) {
    appSubscriptionCreate(
      name: $name,
      returnUrl: $returnUrl,
      lineItems: $lineItems,
      test: $test,
      trialDays: $trialDays
    ) {
      userErrors {
        field
        message
      }
      confirmationUrl
      appSubscription {
        id
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const planKey = formData.get('planKey')?.toString();
  const interval = (formData.get('interval')?.toString() ?? 'monthly') as 'monthly' | 'annual';

  if (!planKey || planKey === 'FREE') {
    return json({ error: 'Invalid plan selection' }, { status: 400 });
  }

  const plan = PLANS.find((p) => p.key === planKey);
  if (!plan) return json({ error: 'Plan not found' }, { status: 400 });

  const billingName = interval === 'annual' && plan.billingPlanNameAnnual
    ? plan.billingPlanNameAnnual
    : plan.billingPlanName;

  if (!billingName) return json({ error: 'No billing plan' }, { status: 400 });

  const pricing = PLAN_PRICING[billingName];
  if (!pricing) return json({ error: `No pricing config for "${billingName}"` }, { status: 400 });

  const isTest =
    process.env.BILLING_TEST_MODE !== undefined
      ? process.env.BILLING_TEST_MODE === 'true'
      : process.env.NODE_ENV === 'development';

  // After charge confirmation, Shopify redirects user to returnUrl in top-level window.
  // We route through /billing/callback to redirect back into Shopify Admin iframe.
  const appUrl = process.env.SHOPIFY_APP_URL ?? 'http://localhost';
  const returnUrl = `${appUrl}/billing/callback?shop=${encodeURIComponent(session.shop)}`;

  logger.app('INFO', 'Creating charge via admin.graphql()', {
    shop: session.shop,
    billingName,
    amount: pricing.amount,
    interval: pricing.interval,
    isTest,
    returnUrl,
  });

  try {
    const response = await admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, {
      variables: {
        name: billingName,
        returnUrl,
        lineItems: [{
          plan: {
            appRecurringPricingDetails: {
              price: {
                amount: pricing.amount,
                currencyCode: 'USD',
              },
              interval: pricing.interval,
            },
          },
        }],
        test: isTest,
        trialDays: pricing.trialDays,
      },
    });

    const result = await response.json();
    logger.app('INFO', 'GraphQL response', {
      shop: session.shop,
      hasUserErrors: result.data?.appSubscriptionCreate?.userErrors?.length > 0,
      hasConfirmationUrl: !!result.data?.appSubscriptionCreate?.confirmationUrl,
    });

    const userErrors = result.data?.appSubscriptionCreate?.userErrors;
    if (userErrors && userErrors.length > 0) {
      const messages = userErrors.map((e: { field: string[]; message: string }) => `${e.field.join('.')}: ${e.message}`).join('; ');
      logger.app('ERROR', 'appSubscriptionCreate userErrors', {
        shop: session.shop,
        billingName,
        userErrors: messages,
      });
      return json({ error: messages }, { status: 400 });
    }

    const confirmationUrl = result.data?.appSubscriptionCreate?.confirmationUrl;
    if (!confirmationUrl) {
      logger.app('ERROR', 'No confirmationUrl in response', {
        shop: session.shop,
        responseData: JSON.stringify(result.data).substring(0, 500),
      });
      return json({ error: 'Shopify did not return a confirmation URL' }, { status: 500 });
    }

    logger.app('INFO', 'Charge created, confirmation URL obtained', {
      shop: session.shop,
      billingName,
    });
    return json({ confirmationUrl });

  } catch (thrown: unknown) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    const stack = thrown instanceof Error ? thrown.stack?.substring(0, 500) : '';
    logger.app('ERROR', 'admin.graphql() call failed', {
      shop: session.shop,
      billingName,
      error: msg,
      errorType: thrown?.constructor?.name ?? typeof thrown,
      stack,
    });
    return json({ error: msg || 'GraphQL request failed' }, { status: 500 });
  }
};
