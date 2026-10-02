import { describe, expect, it } from "vitest";
import { verifyDodoPayment } from "@/server/payments/verifyDodoPayment";

describe("Dodo payment verification", () => {
  const localPayment = {
    id: "local-123",
    user_id: "user-123",
    plan: "basic",
    credits: 5,
    amount: 14000,
    currency: "PHP",
    dodo_checkout_session_id: "session-123",
  };
  const payment = {
    payment_id: "pay-123",
    checkout_session_id: "session-123",
    status: "succeeded",
    total_amount: 14000,
    currency: "PHP",
    metadata: {
      local_payment_id: "local-123",
      user_id: "user-123",
      plan: "basic",
      credits: "5",
    },
    product_cart: [{ product_id: "product-basic", quantity: 1 }],
  };

  it("accepts an exact PHP checkout", () => {
    expect(verifyDodoPayment(localPayment, payment, "product-basic")).toEqual({
      adaptiveCurrency: false,
      paidAmount: 14000,
      paidCurrency: "PHP",
    });
  });

  it("accepts adaptive international currency for the exact purchased product", () => {
    const result = verifyDodoPayment(
      localPayment,
      { ...payment, total_amount: 249, currency: "USD" },
      "product-basic",
    );
    expect(result.adaptiveCurrency).toBe(true);
  });

  it.each([
    ["wrong product", { product_cart: [{ product_id: "product-pro", quantity: 1 }] }],
    ["wrong quantity", { product_cart: [{ product_id: "product-basic", quantity: 2 }] }],
    ["wrong checkout", { checkout_session_id: "session-other" }],
    ["wrong user metadata", { metadata: { ...payment.metadata, user_id: "user-other" } }],
    ["same-currency amount mismatch", { total_amount: 13900 }],
    ["unsuccessful status", { status: "processing" }],
  ])("rejects %s", (_label, override) => {
    expect(() => verifyDodoPayment(
      localPayment,
      { ...payment, ...override },
      "product-basic",
    )).toThrow();
  });
});
