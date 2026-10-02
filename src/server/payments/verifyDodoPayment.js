function normalizeCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

function requireMatchingMetadata(localPayment, payment) {
  const metadata = payment?.metadata || {};
  const checks = [
    ["local_payment_id", localPayment.id],
    ["user_id", localPayment.user_id],
    ["plan", localPayment.plan],
    ["credits", localPayment.credits],
  ];

  for (const [key, expected] of checks) {
    const actual = metadata[key];
    if (actual != null && String(actual) !== String(expected)) {
      throw new Error(`Dodo payment ${key} does not match the checkout`);
    }
  }
}

// Dodo can charge international customers in an adaptive local currency. In that
// case total_amount is not directly comparable with our PHP catalog amount, so
// the signed payment must be tied to the exact Dodo product and local checkout.
export function verifyDodoPayment(localPayment, payment, expectedProductId) {
  if (!localPayment?.id || !localPayment?.user_id) {
    throw new Error("Local Dodo payment is invalid");
  }
  if (!expectedProductId) {
    throw new Error("Dodo product is not configured");
  }
  if (!payment?.payment_id) {
    throw new Error("Dodo payment id is missing");
  }
  if (payment.status && payment.status !== "succeeded") {
    throw new Error("Dodo payment is not successful");
  }

  requireMatchingMetadata(localPayment, payment);

  if (
    localPayment.dodo_checkout_session_id &&
    payment.checkout_session_id &&
    localPayment.dodo_checkout_session_id !== payment.checkout_session_id
  ) {
    throw new Error("Dodo checkout session does not match the local payment");
  }

  const cart = payment.product_cart;
  if (!Array.isArray(cart) || cart.length !== 1) {
    throw new Error("Dodo payment product cart is missing or invalid");
  }

  const item = cart[0];
  if (item?.product_id !== expectedProductId || item?.quantity !== 1) {
    throw new Error("Dodo payment product does not match the selected plan");
  }

  const expectedCurrency = normalizeCurrency(localPayment.currency);
  const paidCurrency = normalizeCurrency(payment.currency);
  if (!expectedCurrency || !paidCurrency) {
    throw new Error("Dodo payment currency is missing");
  }
  if (!Number.isSafeInteger(payment.total_amount) || payment.total_amount <= 0) {
    throw new Error("Dodo payment amount is invalid");
  }

  // Same-currency checkouts must still match exactly. Different currencies are
  // Dodo adaptive-pricing transactions and are authorized by product identity.
  if (paidCurrency === expectedCurrency && payment.total_amount !== localPayment.amount) {
    throw new Error("Dodo payment amount does not match the checkout");
  }

  return {
    adaptiveCurrency: paidCurrency !== expectedCurrency,
    paidAmount: payment.total_amount,
    paidCurrency,
  };
}
