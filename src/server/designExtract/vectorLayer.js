import { createHash } from "node:crypto";
import sharp from "sharp";
import { adminSupabase as db } from "@/lib/supabase";
import { normalizeVector, vectorSvg, vectorInputGeometry } from "@/lib/designVector";
import { MAX_LAYERS } from "@/lib/designExtract";
import { convertDesignLayer } from "./vectorize";
import { ownedProject, prefix, fail } from "./service";
import { uploadDesignAsset } from "./storage";
import { withDesignImageWork } from "./imageWork";

export async function attachVectorLayer(project,layerId,revision){
  if(revision!==project.revision)fail('Project changed. Reload before converting.',409);
  const source=project.manifest.layers.find(l=>l.id===layerId);
  if(!source||source.kind==='svg')fail('Select a raster layer.',400);
  const fingerprint=createHash('sha256').update(`svg-shapes-v1:${source.id}:${source.url}`).digest('hex');
  const id=`svg-${fingerprint.slice(0,32)}`;
  const existing=project.manifest.layers.find(l=>l.id===id);
  if(existing)return {project,layerId:id};
  if(project.manifest.layers.length>=MAX_LAYERS)fail('Maximum 32 layers. Remove a layer before converting.',409);
  const pending=await db.from('design_extract_jobs').select('id').eq('project_id',project.id).in('status',['submitting','queued','processing','saving','ready']).limit(1);
  if(pending.error)throw pending.error;if(pending.data.length)fail('Finish the active extraction before converting SVG artwork.',409);
  const raw=await convertDesignLayer(project,layerId);
  let doc;try{doc=normalizeVector(raw.toString('utf8'),vectorInputGeometry(source.width,source.height));}catch(error){fail(`${error.message}. The original SVG remains available as a standalone download.`,422);}
  const svg=Buffer.from(vectorSvg(doc)),base=`${prefix(project)}svg-layers/${fingerprint}`;
  const preview=await withDesignImageWork(()=>sharp(svg,{limitInputPixels:24000000}).png().toBuffer());
  const [url,previewUrl]=await Promise.all([uploadDesignAsset(svg,`${base}.svg`,'image/svg+xml'),uploadDesignAsset(preview,`${base}.png`,'image/png')]);
  for(let attempt=0;attempt<3;attempt++){
    const current=await ownedProject(project.id,project.user_id);
    if(current.manifest.layers.some(l=>l.id===id))return {project:current,layerId:id};
    const parent=current.manifest.layers.find(l=>l.id===source.id);
    if(!parent||parent.url!==source.url||current.manifest.layers.length>=MAX_LAYERS)fail('Source changed or layer limit reached. The conversion is saved; reload before inserting.',409);
    const active=await db.from('design_extract_jobs').select('id').eq('project_id',project.id).in('status',['submitting','queued','processing','saving','ready']).limit(1);
    if(active.error)throw active.error;if(active.data.length)fail('Finish the active extraction before inserting SVG artwork.',409);
    const bounds=current.manifest.layers.map(l=>({right:l.layout.x+l.width*l.layout.scale,bottom:l.layout.y+l.height*l.layout.scale}));
    const scale=parent.layout.scale;
    const vector={id,kind:'svg',name:`${parent.name} · SVG`,url,previewUrl,width:source.width,height:source.height,sourceLayerId:source.id,sourceFingerprint:fingerprint,converterVersion:'recraft-v1/shapes-v1',vector:{pathCount:doc.pathCount,knotCount:doc.knotCount},visible:true,visibility:{overview:true,composition:true},locked:false,composition:{...parent.composition},layout:{x:Math.max(...bounds.map(b=>b.right))+48,y:parent.layout.y,scale}};
    const manifest={...current.manifest,version:2,layers:[...current.manifest.layers.map(l=>l.id===parent.id?{...l,kind:'raster',visible:false,visibility:{overview:true,composition:false}}:l),vector]};
    const result=await db.from('design_extract_projects').update({manifest,revision:current.revision+1,updated_at:new Date().toISOString()}).eq('id',current.id).eq('user_id',current.user_id).eq('revision',current.revision).select().maybeSingle();
    if(result.error)throw result.error;if(result.data)return {project:result.data,layerId:id};
  }
  fail('Project changed. Retry to insert the saved SVG without converting again.',409);
}
