// API endpoint for Shopify charge creation
import type { ActionFunctionArgs } from '@remix-run/node';
import { json } from '@remix-run/node';
import { authenticate } from '~/shopify.server';
import type { BillingPlanName } from '~/shopify.server';
import { PLANS } from '~/services/billing.server';
import { logger } from '~/services/logger.server';

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
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

  logger.app('INFO', 'Charge creation requested', { shop: session.shop, plan: billingName, interval });

  try {
    await billing.request({
      plan: billingName as BillingPlanName,
      isTest: process.env.NODE_ENV === 'development',
      returnUrl: process.env.SHOPIFY_APP_URL!,
    });
    return json({ error: 'Unexpected' }, { status: 500 });
  } catch (thrown: unknown) {
    if (thrown instanceof Response) {
      const location = thrown.headers.get('Location');
      if (location) {
        const redirectUrl = new URL(location, process.env.SHOPIFY_APP_URL ?? 'http://localhost');
        const chargeUrl = redirectUrl.searchParams.get('exitIframe') ?? location;
        logger.app('INFO', 'Charge URL extracted', { shop: session.shop, plan: billingName });
        return json({ confirmationUrl: chargeUrl });
      }
      return json({ error: 'No redirect URL' }, { status: 500 });
    }
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    logger.app('ERROR', 'Charge creation failed', { shop: session.shop, plan: billingName, error: msg });
    return json({ error: msg || 'Failed' }, { status: 500 });
  }
};
