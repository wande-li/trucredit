// New Customer — with plan quota gating
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import {
  Page,
  Card,
  Text,
  BlockStack,
  InlineStack,
  TextField,
  Button,
  Banner,
  FormLayout,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { checkCustomerQuota, upsertCustomerFromShopify } from "~/services/customer.server";
import { getShopBilling } from "~/services/billing.server";
import { logger } from "~/services/logger.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const quota = await checkCustomerQuota(shop.id, shop.plan);
    const billing = await getShopBilling(shop.id);

    return json({
      quotaAllowed: quota.allowed,
      quotaCurrent: quota.current,
      quotalimit: quota.limit,
      plan: shop.plan,
      needsUpgrade: billing.needsUpgrade || !quota.allowed,
    });
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    logger.app("ERROR", "New customer loader failed", msg);
    throw new Response("Something went wrong", { status: 500 });
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const { session } = await authenticate.admin(request);
    const shopDomain = session.shop.trim();

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, plan: true },
    });

    if (!shop) throw new Response("Shop not found", { status: 404 });

    const quota = await checkCustomerQuota(shop.id, shop.plan);
    if (!quota.allowed) {
      return json({
        error: `Customer quota reached (${quota.current}/${quota.limit}). Please upgrade your plan.`,
      });
    }

    const formData = await request.formData();
    const intent = formData.get("intent")?.toString();

    if (intent !== "create") {
      return json({ error: "Invalid action" }, { status: 400 });
    }

    const email = formData.get("email")?.toString()?.trim() ?? "";
    const name = formData.get("name")?.toString()?.trim() ?? "";
    const company = formData.get("company")?.toString()?.trim() || undefined;
    const phone = formData.get("phone")?.toString()?.trim() || undefined;
    const shopifyCustomerId = formData.get("shopifyCustomerId")?.toString()?.trim() ?? "";

    if (!email) return json({ error: "Email is required" }, { status: 400 });
    if (!name) return json({ error: "Name is required" }, { status: 400 });

    // Check for duplicate email
    const existing = await prisma.customer.findFirst({
      where: { shopId: shop.id, email },
      select: { id: true },
    });

    if (existing) {
      return json({ error: "Customer with this email already exists" }, { status: 400 });
    }

    const customer = await upsertCustomerFromShopify({
      shopId: shop.id,
      shopifyCustomerId: shopifyCustomerId || `manual_${Date.now()}`,
      email,
      name,
      company,
      phone,
    });

    return redirect(`/app/customers/${customer.id}`);
  } catch (e: unknown) {
    if (e instanceof Response) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new Response(`Failed to create customer: ${msg}`, { status: 500 });
  }
};

export default function NewCustomerPage() {
  const { quotaAllowed, quotaCurrent, quotalimit, needsUpgrade } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string }>();

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [shopifyCustomerId, setShopifyCustomerId] = useState("");

  const isBusy = fetcher.state === "submitting";
  const isValid = email.trim() !== "" && name.trim() !== "";

  const handleSubmit = useCallback(() => {
    fetcher.submit(
      {
        intent: "create",
        email: email.trim(),
        name: name.trim(),
        company: company.trim(),
        phone: phone.trim(),
        shopifyCustomerId: shopifyCustomerId.trim(),
      },
      { method: "post" },
    );
  }, [fetcher, email, name, company, phone, shopifyCustomerId]);

  if (!quotaAllowed) {
    return (
      <Page
        title="Add Customer"
        backAction={{ url: "/app/customers" }}
      >
        <Card>
          <BlockStack gap="400" align="center" inlineAlign="center">
            <Text as="h2" variant="headingLg">
              Plan Limit Reached
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              You have {quotaCurrent}/{quotalimit} customers on your current plan.
            </Text>
            <Banner tone="warning">
              <Text as="p" variant="bodyMd">
                Upgrade to Pro to add more customers.
              </Text>
            </Banner>
            <Button url="/app/billing" variant="primary">
              Upgrade Plan
            </Button>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title="Add Customer"
      backAction={{ url: "/app/customers" }}
    >
      <BlockStack gap="400">
        {fetcher.data?.error && (
          <Banner tone="critical">{fetcher.data.error}</Banner>
        )}

        {needsUpgrade && (
          <Banner tone="warning">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="p" variant="bodyMd">
                Approaching plan limit ({quotaCurrent}/{quotalimit}{" "}
                customers). Consider upgrading your plan.
              </Text>
              <Button url="/app/billing" size="slim" variant="plain">
                Upgrade
              </Button>
            </InlineStack>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Customer Information
            </Text>

            <FormLayout>
              <TextField
                label="Email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
                placeholder="customer@example.com"
                requiredIndicator
              />

              <TextField
                label="Name"
                value={name}
                onChange={setName}
                autoComplete="name"
                placeholder="Company or contact name"
                requiredIndicator
              />

              <TextField
                label="Company"
                value={company}
                onChange={setCompany}
                autoComplete="organization"
                placeholder="Optional"
              />

              <TextField
                label="Phone"
                type="tel"
                value={phone}
                onChange={setPhone}
                autoComplete="tel"
                placeholder="Optional"
              />

              <TextField
                label="Shopify Customer ID"
                value={shopifyCustomerId}
                onChange={(value, _id) => setShopifyCustomerId(value)}
                autoComplete="off"
                placeholder="Leave empty for manual entry"
              />
            </FormLayout>

            <InlineStack gap="200" align="end">
              <Button url="/app/customers" variant="secondary">
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={!isValid || isBusy}
                loading={isBusy}
                variant="primary"
              >
                Create Customer
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
