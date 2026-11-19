import { initializeCanvas, writePsd } from "ag-psd";
import JSZip from "jszip";
import { designPsdLimit } from "@/lib/designExtractExportPolicy";
import { normalizeVector, vectorPsdChildren, VECTOR_LIMITS } from "@/lib/designVector";
import { layerVisible } from "@/lib/designLayerTypes";

initializeCanvas((width, height) => new OffscreenCanvas(width, height));
async function bitmap(blob, width, height) {
  const image = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(width || image.width, height || image.height);
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvas;
}
self.onmessage = async ({ data: { format, manifest, files, source } }) => {
  try {
    let blob;
    if (format === "zip") {
      const zip = new JSZip();
      zip.file("manifest.json", JSON.stringify(manifest, null, 2));
      for (const [index, layer] of manifest.layers.entries()) zip.file(`${index + 1}-${layer.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.${layer.kind==='svg'?'svg':'png'}`, files[index]);
      blob = await zip.generateAsync({ type: "blob" });
    } else {
      const { width, height } = manifest;
      const limit = designPsdLimit(manifest);
      if (limit) throw new Error(limit);
      const composite = new OffscreenCanvas(width, height);
      const ctx = composite.getContext("2d");
      const children = [{ name: "Original reference", hidden: true, canvas: await bitmap(source) }];
      let allocated=2*width*height,paths=0,knots=0;
      for (const [index, layer] of manifest.layers.entries()) {
        const placement = layer.composition;
        if(layer.kind==='svg'){
          const doc=normalizeVector(await files[index].text(),{width:layer.width,height:layer.height});
          paths+=doc.pathCount;knots+=doc.knotCount;
          if(paths>VECTOR_LIMITS.documentPaths||knots>VECTOR_LIMITS.documentKnots)throw Error('This PSD exceeds editable shape limits. Download SVG or ZIP instead.');
          const shapes=vectorPsdChildren(doc,placement,layer.name);
          for(const [i,shape] of shapes.entries()){
            const points=shape.vectorMask.paths.flatMap(p=>p.knots.flatMap(k=>k.points));
            const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1);
            const minX=xs.reduce((a,b)=>Math.min(a,b),Infinity),maxX=xs.reduce((a,b)=>Math.max(a,b),-Infinity),minY=ys.reduce((a,b)=>Math.min(a,b),Infinity),maxY=ys.reduce((a,b)=>Math.max(a,b),-Infinity);
            if(!points.length)continue;
            const left=Math.max(0,Math.floor(minX)),top=Math.max(0,Math.floor(minY)),right=Math.min(width,Math.ceil(maxX)),bottom=Math.min(height,Math.ceil(maxY));
            if(right<=left||bottom<=top)continue;
            allocated+=(right-left)*(bottom-top);if(allocated>64000000)throw Error('This PSD exceeds preview memory limits. Download SVG or ZIP instead.');
            const canvas=new OffscreenCanvas(right-left,bottom-top),context=canvas.getContext('2d');
            context.translate(placement.x-left,placement.y-top);context.scale(placement.scale,placement.scale);
            context.beginPath();context.rect(0,0,doc.width,doc.height);context.clip();
            const fill=doc.shapes[i].fill;context.fillStyle=`rgb(${fill.r},${fill.g},${fill.b})`;context.fill(new Path2D(doc.shapes[i].d),doc.shapes[i].paths[0]?.fillRule==='even-odd'?'evenodd':'nonzero');
            Object.assign(shape,{canvas,left,top});
            if(layerVisible(layer)){ctx.globalAlpha=shape.opacity;ctx.drawImage(canvas,left,top);ctx.globalAlpha=1;}
          }
          children.push({name:layer.name,hidden:!layerVisible(layer),protected:{complete:layer.locked},children:shapes});
          continue;
        }
        const canvas = await bitmap(files[index], Math.max(1, Math.round(layer.width * placement.scale)), Math.max(1, Math.round(layer.height * placement.scale)));
        allocated+=canvas.width*canvas.height;if(allocated>64000000)throw Error('This PSD exceeds preview memory limits. Download ZIP instead.');
        const left = Math.round(placement.x), top = Math.round(placement.y);
        children.push({ name: layer.name, hidden: !layerVisible(layer), transparencyProtected: layer.locked, left, top, canvas });
        if (layerVisible(layer)) ctx.drawImage(canvas, left, top);
      }
      blob = new Blob([writePsd({ width, height, canvas: composite, children }, { generateThumbnail: false })], { type: "application/octet-stream" });
    }
    self.postMessage({ blob });
  } catch (error) { self.postMessage({ error: error.message }); }
};
