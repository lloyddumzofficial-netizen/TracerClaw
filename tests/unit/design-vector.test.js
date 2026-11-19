import { expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {writePsd,readPsd} from 'ag-psd';
import {normalizeVector,vectorSvg,vectorPsdChildren,vectorInputGeometry} from '@/lib/designVector';
import {layerVisible} from '@/lib/designLayerTypes';
import {validateEdits} from '@/lib/designExtract';
it('accepts harmless defs without rendering definition-only paths',()=>{
 const doc=normalizeVector('<svg viewBox="0 0 10 10"><defs><path id="unused" d="M0 0h8v8z"/></defs><path fill="#f00" d="M0 0h5v5z"/></svg>',{width:10,height:10});expect(doc.pathCount).toBe(1);
 expect(()=>normalizeVector('<svg viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path fill="url(#g)" d="M0 0h5v5z"/></svg>',{width:10,height:10})).toThrow('solid color');
});
it('restores server-owned SVG assets through undo/redo without accepting replacement URLs',()=>{
 const source={id:'p',url:'owned.png',visible:true,width:10,height:10,layout:{x:0,y:0,scale:1},composition:{x:0,y:0,scale:1}};
 const vector={...source,id:'s',kind:'svg',url:'owned.svg'};
 const initial={layers:[{...source,visible:false,visibility:{overview:true,composition:false}},vector]};
 const undone=validateEdits({layers:[source]},initial);expect(undone.layers[0].visibility.composition).toBe(true);expect(undone.retiredLayers[0].url).toBe('owned.svg');
 const redone=validateEdits({layers:[source,{...vector,url:'https://attacker.test/svg'}]},undone);expect(redone.layers[1].url).toBe('owned.svg');
});
it('normalizes padding, nonzero viewBoxes, transforms and quadratic/arc paths',()=>{
 const doc=normalizeVector('<svg viewBox="10 20 1024 1024" preserveAspectRatio="none"><g transform="translate(10,20)"><path fill="#123" fill-rule="evenodd" d="M10 20q8 0 8 8a4 4 0 1 1 -8 0z"/></g></svg>',{width:32,height:40,inputWidth:256,inputHeight:256,contentWidth:32,contentHeight:40});
 expect(doc.shapes[0].paths[0].knots[0].points.slice(2,4)).toEqual([2.5,5]);expect(doc.shapes[0].paths[0].fillRule).toBe('even-odd');expect(doc.shapes[0].paths[0].knots.length).toBeGreaterThan(3);
});
it('maps the live Recraft viewBox into native layer coordinates and preserves filled shapes',async()=>{
 const svg=await readFile(new URL('../fixtures/recraft-layer-vector.svg',import.meta.url),'utf8');
 const doc=normalizeVector(svg,{width:256,height:256});expect(doc.pathCount).toBe(2);expect(doc.shapes[0].paths[0].knots[0].points[2]).toBeCloseTo(484.254/4);
 expect(normalizeVector(vectorSvg(doc),{width:256,height:256}).pathCount).toBe(2);
});
it('normalizes nested transforms, nonzero viewBoxes, quadratics and arcs',()=>{
 const doc=normalizeVector('<svg viewBox="10 20 100 100"><g transform="translate(5 6)"><path fill="#123" d="M10 20L20 20Q30 30 20 40A5 5 0 0 1 10 40z"/></g></svg>',{width:200,height:200});
 expect(doc.shapes[0].paths[0].knots[0].points.slice(2,4)).toEqual([10,12]);expect(doc.shapes[0].fill).toEqual({r:17,g:34,b:51});
});
it('corrects the coordinate system of transparently padded cutouts',()=>{
 const doc=normalizeVector('<svg viewBox="0 0 1024 1024"><path d="M0 0h120v160z"/></svg>',vectorInputGeometry(30,40));
 expect(doc.shapes[0].paths[0].knots[1].points.slice(2,4)).toEqual([30,0]);
});
it('writes and reads real PSD vector masks and solid fills',()=>{
 const doc=normalizeVector('<svg viewBox="0 0 100 100"><path fill="#f00" d="M0 0h40v40H0z"/><path fill="#0f0" fill-rule="evenodd" d="M50 50h40v40H50z M60 60v10h10v-10z"/></svg>',{width:100,height:100});
 const children=vectorPsdChildren(doc,{x:20,y:30,scale:2},'Logo');
 const bytes=writePsd({width:300,height:300,children:[{name:'Logo · SVG',children}]},{generateThumbnail:false});
 const saved=readPsd(bytes,{skipLayerImageData:true,skipCompositeImageData:true,skipThumbnail:true});
 expect(saved.children[0].children).toHaveLength(2);expect(saved.children[0].children[0].vectorFill).toMatchObject({type:'color',color:{r:255,g:0,b:0}});
 expect(saved.children[0].children[1].vectorMask.paths).toHaveLength(2);expect(saved.children[0].children[0].vectorMask.paths[0].knots[0].points[2]).toBeCloseTo(20,3);
});
it.each(['<image href="x"/>','<path fill="url(#x)" d="M0 0h1z"/>','<path stroke="red" d="M0 0h1z"/>','<script/>'])('rejects unsupported shapes: %s',content=>expect(()=>normalizeVector(`<svg viewBox="0 0 10 10">${content}</svg>`,{width:10,height:10})).toThrow());
it('keeps legacy visibility and independent overview/composition states',()=>{expect(layerVisible({visible:false},'layout')).toBe(false);expect(layerVisible({visible:false,visibility:{overview:true,composition:false}},'layout')).toBe(true);});
