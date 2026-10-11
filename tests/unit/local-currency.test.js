import { describe, expect, it } from "vitest";
import {
  SUPPORTED_BILLING_CURRENCIES,
  currencyForCountry,
  isSupportedBillingCurrency,
  normalizeBillingCurrency,
} from "@/lib/localCurrency";

describe("localized pricing currencies", () => {
  it.each([
    ["PH", "PHP"],
    ["US", "USD"],
    ["GB", "GBP"],
    ["DE", "EUR"],
    ["SG", "SGD"],
    ["JP", "JPY"],
  ])("maps %s to %s", (country, currency) => {
    expect(currencyForCountry(country)).toBe(currency);
  });

  it("falls back safely to PHP for unknown countries", () => {
    expect(currencyForCountry("XX")).toBe("PHP");
    expect(currencyForCountry()).toBe("PHP");
  });

  it("normalizes and allowlists billing currencies", () => {
    expect(normalizeBillingCurrency(" usd ")).toBe("USD");
    expect(isSupportedBillingCurrency("usd")).toBe(true);
    expect(isSupportedBillingCurrency("ZZZ")).toBe(false);
    expect(SUPPORTED_BILLING_CURRENCIES).toContain("PHP");
  });
});