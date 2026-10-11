export const SUPPORTED_BILLING_CURRENCIES = [
  "PHP", "USD", "EUR", "GBP", "AUD", "CAD", "SGD", "MYR",
  "JPY", "KRW", "INR", "IDR", "THB", "AED", "SAR", "NZD",
];

const SUPPORTED_CURRENCY_SET = new Set(SUPPORTED_BILLING_CURRENCIES);

const EURO_COUNTRIES = new Set([
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES",
]);

const COUNTRY_CURRENCIES = {
  PH: "PHP", US: "USD", GB: "GBP", AU: "AUD", CA: "CAD", SG: "SGD",
  MY: "MYR", JP: "JPY", KR: "KRW", IN: "INR", ID: "IDR", TH: "THB",
  AE: "AED", SA: "SAR", NZ: "NZD",
};

export function normalizeBillingCurrency(value) {
  return String(value || "").trim().toUpperCase();
}

export function isSupportedBillingCurrency(value) {
  return SUPPORTED_CURRENCY_SET.has(normalizeBillingCurrency(value));
}

export function currencyForCountry(countryCode) {
  const country = String(countryCode || "").trim().toUpperCase();
  if (EURO_COUNTRIES.has(country)) return "EUR";
  return COUNTRY_CURRENCIES[country] || "PHP";
}