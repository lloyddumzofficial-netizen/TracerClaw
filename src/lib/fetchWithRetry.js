/**
 * Utility function to handle API rate limits (429) and server errors (50x)
 * using exponential backoff.
 */
export async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let attempt = 0;
  const baseDelayMs = 1500; // Start with 1.5s delay

  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, options);

      // 429 Too Many Requests is our main target for exponential backoff
      if (response.status === 429) {
        throw new Error(`Rate limit exceeded (429)`);
      }

      // Also retry on occasional 502/503/504 errors from API providers
      if (response.status >= 502 && response.status <= 504) {
        throw new Error(`Server error (${response.status})`);
      }

      return response; // Return the successful response (or 400/401 which shouldn't be retried)
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`[fetchWithRetry] Max retries (${maxRetries}) reached for ${url}`);
        throw error;
      }
      // Exponential backoff: 1.5s, 3s, 6s... plus random jitter to prevent thundering herd
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500;
      console.warn(`[fetchWithRetry] Attempt ${attempt} failed: ${error.message}. Retrying in ${Math.round(delayMs)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
