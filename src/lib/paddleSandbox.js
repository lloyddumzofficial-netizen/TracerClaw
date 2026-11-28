import { adminSupabase } from "@/lib/supabase";
import { POLAR_CREDIT_PLANS } from "@/lib/paymentPlans";

export const priceIds = {
  basic: "pri_01m8ekt3ghxnnw00wpbtq26wga",
  starter: "pri_01m8ektdg15zpkfzbjrrwjy62p",
  pro: "pri_01m8ektfxaa2zandz8msycq9bj",
};

export async function grantSandboxClaws(data, userId) {
  const completedPlan = data.custom_data.desaynclaw_plan;
  const offer = Object.hasOwn(priceIds, completedPlan) ? POLAR_CREDIT_PLANS[completedPlan] : null;
  const [item] = data.items ?? [];
  if (!offer || data.currency_code !== "USD" || data.collection_mode !== "automatic" ||
    data.discount_id || data.items?.length !== 1 || item.quantity !== 1 ||
    item.price?.id !== priceIds[completedPlan] || item.price?.unit_price?.amount !== String(offer.amount) ||
    item.price?.unit_price?.currency_code !== "USD") {
    return Response.json({ error: "Sandbox payment does not match the Claw pack" }, { status: 409 });
  }
  const { data: granted, error } = await adminSupabase.rpc("grant_paddle_sandbox_claws", {
    transaction_id: data.id, test_user_id: userId, claws: offer.credits,
  });
  if (error) throw error;
  return Response.json({ status: "completed", granted, credits: offer.credits });
}
