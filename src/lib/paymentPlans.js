export const CREDIT_PLANS = {
  tingi: {
    key: "tingi",
    label: "Mini",
    credits: 2,
    price: "₱50",
    amount: 5000,
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_TINGI",
    dodoEnabled: false,
  },
  basic: {
    key: "basic",
    label: "Basic",
    credits: 4,
    price: "₱100",
    amount: 10000,
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_BASIC",
    dodoEnabled: true,
  },
  starter: {
    key: "starter",
    label: "Starter",
    credits: 13,
    price: "₱290",
    amount: 29000,
    currency: "PHP",
    dodoProductEnv: "DODO_PRODUCT_STARTER",
    dodoEnabled: true,
  },
  pro: {
    key: "pro",
    label: "Professional",
    credits: 45,
    price: "₱870",
    amount: 87000,
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
