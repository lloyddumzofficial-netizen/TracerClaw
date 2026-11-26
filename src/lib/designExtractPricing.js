// Tariff policy only. Charging must happen atomically with the owned job claim.
// Never treat a missing ledger/RPC as permission to run a paid operation free.
export const DESIGN_EXTRACT_PRICE_VERSION = "design-extract-v1";
export const DESIGN_EXTRACT_DEFAULT_BILLING_MODE = "paid";
export const DESIGN_EXTRACT_CLAWS = Object.freeze({ extract: 2, split: 2, segment: 1, refine: 2 });
export function designExtractPrice(kind) {
  if (!Object.hasOwn(DESIGN_EXTRACT_CLAWS, kind)) throw new Error("Unknown Design Extract operation");
  return DESIGN_EXTRACT_CLAWS[kind];
}
