// Bound decoded frames within one server process, including concurrent HTTP
// pollers. Database leases additionally bound workflow work per user.
let active = false;
const waiting = [];
const busy = () => Object.assign(new Error('Image processing is busy. Please retry shortly.'), { status: 503, designExtractError: true });

export async function withDesignImageWork(operation) {
  if (active) {
    if (waiting.length >= 4) throw busy();
    await new Promise((resolve, reject) => {
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(busy());
      }, 15000);
      waiting.push(entry);
    });
  } else active = true;
  try { return await operation(); }
  finally {
    const next = waiting.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else active = false;
  }
}
