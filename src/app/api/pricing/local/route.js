import { NextResponse } from "next/server";
import {
  currencyForCountry,
  isSupportedBillingCurrency,
  normalizeBillingCurrency,
} from "@/lib/localCurrency";

export const runtime = "nodejs";

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

  const currency = requested || currencyForCountry(country);
  if (currency === "PHP") {
    return response({ baseCurrency: "PHP", country, currency, rate: 1, estimated: false });
  }

  try {
    const rateResponse = await fetch(
      `https://api.frankfurter.dev/v2/rate/php/${currency.toLowerCase()}`,
      { next: { revalidate: 86_400 } },
    );
    if (!rateResponse.ok) throw new Error(`Rate service returned ${rateResponse.status}`);
    const data = await rateResponse.json();
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("Invalid exchange rate");

    return response({
      baseCurrency: "PHP",
      country,
      currency,
      rate,
      rateDate: data.date || null,
      estimated: true,
    });
  } catch (error) {
    console.warn("[Localized Pricing] Falling back to PHP:", error);
    return response({
      baseCurrency: "PHP",
      country,
      currency: "PHP",
      rate: 1,
      estimated: false,
      fallback: true,
    });
  }
}