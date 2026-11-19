import { expect, it } from 'vitest';
import { designPsdLimit } from '@/lib/designExtractExportPolicy';
it('counts the hidden reference and composite when allowing layers at the aggregate pixel limit',()=>{expect(designPsdLimit({width:4000,height:4000,layers:[{width:16000,height:8000,composition:{scale:.5}}]})).toBeNull();});
it('rejects excessive aggregate pixels before export downloads start',()=>{expect(designPsdLimit({width:8000,height:4000,layers:[{width:8001,height:4000,composition:{scale:1}}]})).toContain('PNG');});
it('rejects a single enormous layer even when its narrow shape fits the aggregate budget',()=>{expect(designPsdLimit({width:100,height:100,layers:[{width:16001,height:1,composition:{scale:1}}]})).toContain('ZIP');});
it('rejects invalid native dimensions and transforms',()=>{for(const width of [NaN,0,-1])expect(designPsdLimit({width,height:100,layers:[]})).toBeTruthy();expect(designPsdLimit({width:100,height:100,layers:[{width:100,height:100,composition:{scale:NaN}}]})).toBeTruthy();});
