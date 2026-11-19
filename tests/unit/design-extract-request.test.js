import { expect, it, vi } from 'vitest';
import { designJson } from '@/server/designExtract/request';
const request = body => new Request('https://local.test', { method: 'POST', body });
it('accepts an editing object and rejects malformed/non-object JSON with 400', async () => {
  expect(await designJson(request('{"revision":3,"layers":[]}'))).toEqual({ revision: 3, layers: [] });
  for (const body of ['null', '[]', 'false', '"text"', '{', '']) await expect(designJson(request(body))).rejects.toMatchObject({ status: 400 });
});
it('rejects oversized declared and chunked bodies before parsing', async () => {
  await expect(designJson(new Request('https://local.test', { method: 'POST', headers: { 'content-length': '999999' }, body: '{}' }))).rejects.toMatchObject({ status: 413 });
  let cancelled = false;
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(256 * 1024)); c.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  await expect(designJson(new Request('https://local.test', { method: 'POST', body: stream, duplex: 'half' }))).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toBe(true);
});
it('times out a stalled body and cancels its reader', async () => {
  vi.useFakeTimers();
  try {
    let cancelled = false;
    const stream = new ReadableStream({ cancel() { cancelled = true; } });
    const result = expect(designJson(new Request('https://local.test', { method: 'POST', body: stream, duplex: 'half' }))).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(10000); await result; expect(cancelled).toBe(true);
  } finally { vi.useRealTimers(); }
});
