// Payment Customization Function — TruCredit credit check
// Runs during Shopify checkout to show/hide/rename payment methods based on credit eligibility.
// Target: ES2023 (Shopify Functions runtime)
//
// Data flow:
// 1. TruCredit backend writes credit_status JSON to customer.metafield("trucredit", "credit_status")
// 2. This Function reads the metafield at checkout time (zero network cost)
// 3. If frozen or no credit → hide net terms payment method
// 4. If eligible → show net terms with available credit amount

/**
 * @typedef {Object} Input
 * @property {Object} cart
 * @property {Array} paymentMethods
 */

/**
 * @typedef {Object} PaymentMethod
 * @property {string} id
 * @property {string} name
 */

/**
 * @typedef {Object} FunctionResult
 * @property {Array} operations
 */

/**
 * Main entry point.
 * @param {Input} input
 * @returns {FunctionResult}
 */
function run(input) {
  const operations = [];
  const customerEmail = input.cart?.buyerIdentity?.email ?? "";

  // Read credit status from metafield (populated by TruCredit backend)
  const metafieldValue = input.cart?.buyerIdentity?.customer?.metafield?.value;
  let credit = null;
  if (metafieldValue) {
    try { credit = JSON.parse(metafieldValue); } catch (_) { /* ignore parse errors */ }
  }

  // Scenario 1: Guest checkout — hide net terms entirely
  if (!customerEmail) {
    return hideNetTerms(input.paymentMethods);
  }

  // Scenario 2: Customer but no credit data — hide net terms (not enrolled)
  if (!credit) {
    return hideNetTerms(input.paymentMethods);
  }

  // Scenario 3: Frozen account — hide net terms
  if (credit.isFrozen) {
    return hideNetTerms(input.paymentMethods);
  }

  // Scenario 4: Eligible — show net terms and rename to show available credit
  for (const pm of input.paymentMethods) {
    if (isNetTermsPayment(pm)) {
      operations.push({
        rename: {
          paymentMethodId: pm.id,
          name: `Net Terms (Available: $${Number(credit.creditAvailable || 0).toFixed(0)})`,
        },
      });
    }
  }

  return { operations };
}

/**
 * Hide all net terms payment methods.
 */
function hideNetTerms(paymentMethods) {
  const operations = [];
  for (const pm of paymentMethods) {
    if (isNetTermsPayment(pm)) {
      operations.push({ hide: { paymentMethodId: pm.id } });
    }
  }
  return { operations };
}

/**
 * Match payment methods by name pattern.
 */
function isNetTermsPayment(pm) {
  const name = (pm?.name ?? "").toLowerCase();
  return name.includes("net terms") || name.includes("net 30") || name.includes("trucredit");
}

// Shopify Functions entry point
export { run };

