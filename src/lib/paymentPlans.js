export const CREDIT_PLANS = {
  tingi: {
    key: "tingi",
    label: "Mini",
    credits: 2,
    price: "₱60",
    amount: 6000,       // ₱60 = 6000 centavos | ₱30/credit
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_TINGI",
    dodoEnabled: false, // GCash only — no Dodo for Mini
  },
  basic: {
    key: "basic",
    label: "Basic",
    credits: 5,
    price: "₱140",
    amount: 14000,      // ₱140 = 14000 centavos | ₱28/credit
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_BASIC",
    dodoEnabled: true,
  },
  starter: {
    key: "starter",
    label: "Starter",
    credits: 10,
    price: "₱260",
    amount: 26000,      // ₱260 = 26000 centavos | ₱26/credit
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_STARTER",
    dodoEnabled: true,
  },
  pro: {
    key: "pro",
    label: "Professional",
    credits: 35,
    price: "₱840",
    amount: 84000,      // ₱840 = 84000 centavos | ₱24/credit
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_PRO",
    dodoEnabled: true,
  },
};

export function getCreditPlan(planKey) {
  return CREDIT_PLANS[String(planKey || "").toLowerCase()] || null;
}

export function getDodoProductId(plan) {
  if (!plan?.dodoProductEnv) return null;
  return process.env[plan.dodoProductEnv] || null;
}
