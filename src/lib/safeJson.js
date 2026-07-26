export async function safeJson(response, fallbackMessage = "Request failed") {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return {
    error: response.ok ? fallbackMessage : `${fallbackMessage}. Please try again.`,
  };
}
