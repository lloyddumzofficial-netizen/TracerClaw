import { NextResponse } from "next/server";
import {
  currencyForCountry,
  isSupportedBillingCurrency,
  normalizeBillingCurrency,
} from "@/lib/localCurrency";
import { DODO_CREDIT_PLANS, PAYMONGO_CREDIT_PLANS } from "@/lib/paymentPlans";

export const runtime = "nodejs";

function publicPlans(plans) {
  return Object.fromEntries(Object.values(plans).map((plan) => [plan.key, {
    key: plan.key,
    label: plan.label,
    credits: plan.credits,
    amount: plan.amount,
    currency: plan.currency,
    price: plan.price,
  }]));
}

async function localizedCatalog(baseCurrency, displayCurrency, plans) {
  if (baseCurrency === displayCurrency) {
    return { baseCurrency, displayCurrency, rate: 1, estimated: false, plans: publicPlans(plans) };
  }

  const rateResponse = await fetch(
    `https://api.frankfurter.dev/v2/rate/${baseCurrency.toLowerCase()}/${displayCurrency.toLowerCase()}`,
    { next: { revalidate: 86_400 } },
  );
  if (!rateResponse.ok) throw new Error(`Rate service returned ${rateResponse.status}`);
  const data = await rateResponse.json();
  const rate = Number(data.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid exchange rate");
  return {
    baseCurrency,
    displayCurrency,
    rate,
    rateDate: data.date || null,
    estimated: true,
    plans: publicPlans(plans),
  };
}

async function localizedCatalogWithFallback(baseCurrency, displayCurrency, plans) {
  try {
    return await localizedCatalog(baseCurrency, displayCurrency, plans);
  } catch (error) {
    console.warn(`[Localized Pricing] ${baseCurrency} conversion unavailable:`, error);
    return {
      baseCurrency,
      displayCurrency: baseCurrency,
      rate: 1,
      estimated: false,
      fallback: true,
      plans: publicPlans(plans),
    };
  }
}

function response(body, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=300",
      Vary: "x-vercel-ip-country",
    },
  });
}

export async function GET(request) {
  const country = String(request.headers.get("x-vercel-ip-country") || "").toUpperCase();
  const requested = normalizeBillingCurrency(new URL(request.url).searchParams.get("currency"));
  if (requested && !isSupportedBillingCurrency(requested)) {
    return response({ error: "Unsupported currency" }, 400);
  }

  const isPhilippines = !country || country === "PH";
  const detectedCurrency = currencyForCountry(country);
  const currency = requested || (isPhilippines ? "PHP" : detectedCurrency === "PHP" ? "USD" : detectedCurrency);
  const primaryProvider = isPhilippines ? "paymongo" : "dodo";

  try {
    const [paymongo, dodo] = await Promise.all([
      isPhilippines ? localizedCatalogWithFallback("PHP", currency, PAYMONGO_CREDIT_PLANS) : null,
      localizedCatalogWithFallback("USD", currency, DODO_CREDIT_PLANS),
    ]);
    const providers = { ...(paymongo ? { paymongo } : {}), dodo };
    const primary = providers[primaryProvider];

    return response({
      country,
      currency: primary.displayCurrency,
      baseCurrency: primary.baseCurrency,
      rate: primary.rate,
      rateDate: primary.rateDate || null,
      estimated: primary.estimated,
      fallback: Boolean(primary.fallback),
      primaryProvider,
      providers,
    });
  } catch (error) {
    const fallbackProvider = primaryProvider;
    const fallbackCurrency = fallbackProvider === "paymongo" ? "PHP" : "USD";
    const fallbackPlans = fallbackProvider === "paymongo" ? PAYMONGO_CREDIT_PLANS : DODO_CREDIT_PLANS;
    console.warn(`[Localized Pricing] Falling back to ${fallbackCurrency}:`, error);
    return response({
      country,
      currency: fallbackCurrency,
      baseCurrency: fallbackCurrency,
      rate: 1,
      estimated: false,
      fallback: true,
      primaryProvider: fallbackProvider,
      providers: {
        [fallbackProvider]: {
          baseCurrency: fallbackCurrency,
          displayCurrency: fallbackCurrency,
          rate: 1,
          estimated: false,
          plans: publicPlans(fallbackPlans),
        },
      },
    });
  }
}
