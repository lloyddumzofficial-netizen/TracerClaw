const MAX_JSON_BYTES = 256 * 1024;
const invalid = (message, status) => Object.assign(new Error(message), { status, designExtractError: true });

// Bound streamed bodies too; Content-Length is neither required nor trusted.
export async function designJson(request) {
  if (Number(request.headers.get('content-length')) > MAX_JSON_BYTES) throw invalid('Request is too large.', 413);
  if (!request.body) throw invalid('Use a JSON request object.', 400);
  const reader = request.body.getReader(), chunks = [];
  let size = 0, timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(invalid('Request timed out.', 408)); void reader.cancel().catch(() => {}); }, 10000); });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_JSON_BYTES) { void reader.cancel().catch(() => {}); throw invalid('Request is too large.', 413); }
      chunks.push(value);
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw invalid('Use a valid JSON request object.', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw invalid('Use a JSON request object.', 400);
    return body;
  } finally { clearTimeout(timer); reader.releaseLock(); }
}
