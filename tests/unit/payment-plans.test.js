import { describe, expect, it } from "vitest";
import {
  DODO_CREDIT_PLANS,
  PAYMONGO_CREDIT_PLANS,
  getPaymentOffer,
} from "@/lib/paymentPlans";

describe("payment catalogs", () => {
  it("publishes the approved Philippine PayMongo prices", () => {
    expect(Object.fromEntries(Object.entries(PAYMONGO_CREDIT_PLANS).map(([key, plan]) => [key, plan.amount]))).toEqual({
      tingi: 6900,
      basic: 15900,
      starter: 28900,
      pro: 89900,
    });
    expect(Object.values(PAYMONGO_CREDIT_PLANS).every((plan) => plan.currency === "PHP")).toBe(true);
  });

  it("publishes the approved international Dodo prices without Mini", () => {
    expect(Object.fromEntries(Object.entries(DODO_CREDIT_PLANS).map(([key, plan]) => [key, plan.amount]))).toEqual({
      basic: 599,
      starter: 1099,
      pro: 2999,
    });
    expect(DODO_CREDIT_PLANS.tingi).toBeUndefined();
    expect(Object.values(DODO_CREDIT_PLANS).every((plan) => plan.currency === "USD")).toBe(true);
  });

  it("resolves provider-specific offers server-side", () => {
    expect(getPaymentOffer("paymongo", "basic")).toEqual(expect.objectContaining({ amount: 15900, currency: "PHP", credits: 5 }));
    expect(getPaymentOffer("dodo", "basic")).toEqual(expect.objectContaining({ amount: 599, currency: "USD", credits: 5 }));
    expect(getPaymentOffer("dodo", "tingi")).toBeNull();
  });
});
