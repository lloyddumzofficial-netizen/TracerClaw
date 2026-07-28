import { enforceRateLimit } from "@/lib/rateLimit";

export async function withUserRateLimit(user, options) {
  return enforceRateLimit({
    ...options,
    identifier: user?.id,
  });
}
