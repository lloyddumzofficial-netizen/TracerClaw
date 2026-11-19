import { expect, it } from 'vitest';
import { packMaskCoverage, unpackMaskCoverage, maskHistoryLimit } from '@/features/design-extract/maskHistory';
it('retains exact 8-bit coverage at one byte per pixel',()=>{
 const pixels=new Uint8ClampedArray(Array.from({length:256},(_,v)=>[v,v,v,255]).flat());
 const packed=packMaskCoverage(pixels);
 expect(packed.byteLength).toBe(pixels.byteLength/4);
 expect(unpackMaskCoverage(packed)).toEqual(pixels);
});
it('keeps retained undo and redo coverage within 64 MB at maximum native size',()=>{
 for(const [width,height] of [[6000,4000],[3372,5086],[1000,1000]]){
  const limit=maskHistoryLimit(width,height);expect(limit).toBeGreaterThan(0);expect(limit).toBeLessThanOrEqual(12);expect(limit*width*height).toBeLessThanOrEqual(64_000_000);
 }
 expect(maskHistoryLimit(6000,4000)).toBe(2);
});
