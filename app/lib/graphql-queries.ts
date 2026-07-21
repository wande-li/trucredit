// TruCredit — Shopify GraphQL queries & mutations
// All queries use the Admin GraphQL API, called via shopify.server.ts authenticate

// ─── B2B Companies ────────────────────────────────────────

export const GET_COMPANIES = `#graphql
  query GetCompanies($first: Int!, $after: String) {
    companies(first: $first, after: $after) {
      edges {
        node {
          id
          name
          createdAt
          updatedAt
          contactCount
          locations(first: 10) {
            edges {
              node {
                id
                name
                billingAddress {
                  address1
                  city
                  province
                  country
                  zip
                }
                buyerExperienceConfiguration {
                  paymentTermsTemplate {
                    paymentTermsType
                    dueInDays
                  }
                }
              }
            }
          }
          contacts(first: 10) {
            edges {
              node {
                id
                customer {
                  id
                  email
                  firstName
                  lastName
                  phone
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ─── Orders ───────────────────────────────────────────────

export const GET_ORDERS = `#graphql
  query GetOrders($first: Int!, $query: String, $after: String) {
    orders(first: $first, query: $query, after: $after, sortKey: CREATED_AT, reverse: true) {
      edges {
        node {
          id
          name
          createdAt
          displayFinancialStatus
          totalPriceSet {
            shopMoney { amount currencyCode }
          }
          customer {
            id email firstName lastName
          }
          purchasingEntity {
            ... on PurchasingCompany {
              company { id name }
              location { id name }
            }
          }
          paymentTerms {
            paymentTermsType
            dueInDays
            overdue
            paymentSchedules(first: 5) {
              edges {
                node {
                  dueAt
                  completedAt
                  amount { amount currencyCode }
                }
              }
            }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// ─── Draft Orders ─────────────────────────────────────────

export const DRAFT_ORDER_CREATE = `#graphql
  mutation DraftOrderCreate($input: DraftOrderInput!) {
    draftOrderCreate(input: $input) {
      draftOrder {
        id
        invoiceUrl
        status
        totalPriceSet {
          shopMoney { amount currencyCode }
        }
      }
      userErrors { field message }
    }
  }
`;

export const DRAFT_ORDER_INVOICE_SEND = `#graphql
  mutation DraftOrderInvoiceSend($id: ID!, $email: EmailInput) {
    draftOrderInvoiceSend(id: $id, email: $email) {
      draftOrder { id invoiceSentAt }
      userErrors { field message }
    }
  }
`;

export const ORDER_INVOICE_SEND = `#graphql
  mutation OrderInvoiceSend($id: ID!, $email: EmailInput) {
    orderInvoiceSend(id: $id, email: $email) {
      order { id }
      userErrors { field message }
    }
  }
`;

// ─── Payment Terms ────────────────────────────────────────

export const PAYMENT_TERMS_CREATE = `#graphql
  mutation PaymentTermsCreate($referenceId: ID!, $paymentTermsAttributes: PaymentTermsCreateInput!) {
    paymentTermsCreate(referenceId: $referenceId, paymentTermsAttributes: $paymentTermsAttributes) {
      paymentTerms {
        id paymentTermsType dueInDays overdue
        paymentSchedules(first: 5) {
          edges { node { dueAt amount { amount } } }
        }
      }
      userErrors { field message }
    }
  }
`;

export const GET_PAYMENT_TERMS_TEMPLATES = `#graphql
  query GetPaymentTermsTemplates {
    paymentTermsTemplates {
      id name paymentTermsType dueInDays description
    }
  }
`;

// ─── Metafields ───────────────────────────────────────────

export const METAFIELDS_SET = `#graphql
  mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value }
      userErrors { field message }
    }
  }
`;

export const GET_CUSTOMER_METAFIELD = `#graphql
  query GetCustomerMetafield($customerId: ID!) {
    customer(id: $customerId) {
      id email firstName lastName
      metafield(namespace: "trucredit", key: "credit_status") {
        value updatedAt
      }
    }
  }
`;

// APP_SUBSCRIPTION_CREATE removed — replaced by Shopify Managed Pricing (shopify.app.toml)
// WEBHOOK_SUBSCRIPTION_CREATE removed — replaced by shopify.app.toml webhooks config
