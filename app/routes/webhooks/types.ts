// Shared types for webhook handlers
import type { AdminApiContext } from "@shopify/shopify-app-remix/server";

export interface ShopifyPayload {
  id?: number | string;
  shop_domain?: string;
  myshopify_domain?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  name?: string;
  total_price?: string | number;
  currency?: string;
  financial_status?: string;
  customer?: ShopifyPayload;
  app_subscription?: ShopifyPayload;
  contacts?: Array<{ id: string; customer?: { id: string; email?: string; firstName?: string; lastName?: string; phone?: string } }>;
  default_address?: { company?: string };
  order_id?: number | string;
  source_name?: string;
  refund_line_items?: Array<{ quantity?: number; subtotal?: number | string }>;
  transactions?: Array<{ amount?: string | number; kind?: string }>;
}

export interface WebhookContext {
  topic: string;
  payload: ShopifyPayload;
  shopDomain: string;
  shopifyAdmin: AdminApiContext | undefined;
}
