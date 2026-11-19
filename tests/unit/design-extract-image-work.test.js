import { expect, it, vi } from 'vitest';
import { withDesignImageWork } from '@/server/designExtract/imageWork';
it('serializes decoded image work and releases the next request after failure',async()=>{
  let release;const barrier=new Promise(resolve=>{release=resolve;});const order=[];
  const first=withDesignImageWork(async()=>{order.push('first');await barrier;throw new Error('decode failed');});
  const rejected=expect(first).rejects.toThrow('decode failed');
  const second=withDesignImageWork(async()=>{order.push('second');return 'saved';});
  expect(order).toEqual(['first']);release();await rejected;expect(await second).toBe('saved');expect(order).toEqual(['first','second']);
});
it('bounds waiting requests and expires queued work without running it',async()=>{
  vi.useFakeTimers();let release;const first=withDesignImageWork(()=>new Promise(resolve=>{release=resolve;}));
  try {
    const work=vi.fn();const waiting=Array.from({length:4},()=>withDesignImageWork(work));
    const settled=Promise.allSettled(waiting);
    await expect(withDesignImageWork(work)).rejects.toMatchObject({status:503});
    await vi.advanceTimersByTimeAsync(15000);expect((await settled).every(result=>result.status==='rejected')).toBe(true);expect(work).not.toHaveBeenCalled();
  } finally {release();await first;vi.useRealTimers();}
  expect(await withDesignImageWork(async()=>true)).toBe(true);
});
