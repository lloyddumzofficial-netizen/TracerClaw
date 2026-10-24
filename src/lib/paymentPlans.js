const PLAN_DEFINITIONS = {
  tingi: { key: "tingi", label: "Mini", credits: 2 },
  basic: { key: "basic", label: "Basic", credits: 5 },
  starter: { key: "starter", label: "Starter", credits: 10 },
  pro: { key: "pro", label: "Professional", credits: 35 },
};

export const PAYMONGO_CATALOG_VERSION = "paymongo_ph_2026_11";
export const DODO_CATALOG_VERSION = "dodo_intl_2026_11";

function withOffer(definition, offer) {
  const major = offer.amount / 100;
  return {
    ...definition,
    ...offer,
    price: new Intl.NumberFormat(offer.currency === "PHP" ? "en-PH" : "en-US", {
      style: "currency",
      currency: offer.currency,
      minimumFractionDigits: offer.currency === "PHP" ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major),
  };
}

/** Philippine QR Ph catalog. Amounts are in centavos. */
export const PAYMONGO_CREDIT_PLANS = {
  tingi: withOffer(PLAN_DEFINITIONS.tingi, { amount: 6900, currency: "PHP", catalogVersion: PAYMONGO_CATALOG_VERSION }),
  basic: withOffer(PLAN_DEFINITIONS.basic, { amount: 15900, currency: "PHP", catalogVersion: PAYMONGO_CATALOG_VERSION }),
  starter: withOffer(PLAN_DEFINITIONS.starter, { amount: 28900, currency: "PHP", catalogVersion: PAYMONGO_CATALOG_VERSION }),
  pro: withOffer(PLAN_DEFINITIONS.pro, { amount: 89900, currency: "PHP", catalogVersion: PAYMONGO_CATALOG_VERSION }),
};

/** International card catalog. Amounts are in US cents. */
export const DODO_CREDIT_PLANS = {
  basic: withOffer(PLAN_DEFINITIONS.basic, {
    amount: 599,
    currency: "USD",
    catalogVersion: DODO_CATALOG_VERSION,
    dodoProductEnv: "DODO_PRODUCT_INTL_BASIC_V2",
    legacyDodoProductEnv: "DODO_PRODUCT_BASIC",
  }),
  starter: withOffer(PLAN_DEFINITIONS.starter, {
    amount: 1099,
    currency: "USD",
    catalogVersion: DODO_CATALOG_VERSION,
    dodoProductEnv: "DODO_PRODUCT_INTL_STARTER_V2",
    legacyDodoProductEnv: "DODO_PRODUCT_STARTER",
  }),
  pro: withOffer(PLAN_DEFINITIONS.pro, {
    amount: 2999,
    currency: "USD",
    catalogVersion: DODO_CATALOG_VERSION,
    dodoProductEnv: "DODO_PRODUCT_INTL_PRO_V2",
    legacyDodoProductEnv: "DODO_PRODUCT_PRO",
  }),
};

// Backwards-compatible public catalog used by Philippine marketing and manual
// admin tooling. Provider checkouts must use getPaymentOffer instead.
export const CREDIT_PLANS = PAYMONGO_CREDIT_PLANS;

export function getCreditPlan(planKey) {
  return PAYMONGO_CREDIT_PLANS[String(planKey || "").toLowerCase()] || null;
}

export function getPaymentOffer(provider, planKey) {
  const key = String(planKey || "").toLowerCase();
  if (provider === "paymongo") return PAYMONGO_CREDIT_PLANS[key] || null;
  if (provider === "dodo") return DODO_CREDIT_PLANS[key] || null;
  return null;
}

export function getDodoProductId(offer) {
  if (!offer?.dodoProductEnv) return null;
  return process.env[offer.dodoProductEnv] || null;
}

export function getLegacyDodoProductId(planKey) {
  const offer = getPaymentOffer("dodo", planKey);
  if (!offer?.legacyDodoProductEnv) return null;
  return process.env[offer.legacyDodoProductEnv] || null;
}
