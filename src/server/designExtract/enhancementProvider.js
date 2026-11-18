// The installed fal queue SDK retries POST submissions internally. Paid
// enhancements use one HTTP attempt so a lost response cannot duplicate work.
export async function submitEnhancement(input) {
  if (!process.env.FAL_KEY) throw new Error("Enhancement provider is not configured");
  const response = await fetch("https://queue.fal.run/fal-ai/esrgan", {
    method: "POST", redirect: "error", cache: "no-store",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input), signal: AbortSignal.timeout(40_000),
  });
  if (!response.ok) throw Object.assign(new Error("Enhancement provider did not confirm submission"), { status: response.status });
  const receipt = await response.json();
  if (typeof receipt.request_id !== "string" || !/^[a-zA-Z0-9-]{8,120}$/.test(receipt.request_id)) throw new Error("Enhancement provider returned no valid receipt");
  return { request_id: receipt.request_id };
}
