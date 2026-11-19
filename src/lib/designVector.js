import { SaxesParser } from "saxes";
import svgpath from "svgpath";

export const VECTOR_LIMITS = { paths: 2000, knots: 100000, documentPaths: 5000, documentKnots: 250000 };
export const layerVisible = (layer, view = "composition") => layer.visibility?.[view === "layout" ? "overview" : "composition"] ?? layer.visible !== false;
export function vectorInputGeometry(width,height){const ratio=Math.min(1,4000/width,4000/height),contentWidth=Math.max(1,Math.round(width*ratio)),contentHeight=Math.max(1,Math.round(height*ratio));return {width,height,contentWidth,contentHeight,inputWidth:Math.max(256,contentWidth),inputHeight:Math.max(256,contentHeight)};}
const invalid = message => { throw new Error(`SVG shapes: ${message}`); };
const number = (value, fallback = 0) => value === undefined ? fallback : Number(value);
const multiply = (a,b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
function matrix(text = "") {
  // Let svgpath apply the full SVG transform grammar to a basis.
  const points=[];const path=svgpath('M0 0L1 0L0 1').transform(text).abs();
  path.iterate(s=>points.push(s.slice(-2)));
  if(path.err || points.flat().some(n=>!Number.isFinite(n)))invalid('invalid transform');
  return [points[1][0]-points[0][0],points[1][1]-points[0][1],points[2][0]-points[0][0],points[2][1]-points[0][1],...points[0]];
}
function color(value) {
  if(value==='none')return null;
  if(value==='black'||!value)return {r:0,g:0,b:0};
  if(value==='white')return {r:255,g:255,b:255};
  let match=/^#([\da-f]{3}|[\da-f]{6})$/i.exec(value);
  if(match){const hex=match[1].length===3?[...match[1]].map(x=>x+x).join(''):match[1];return {r:parseInt(hex.slice(0,2),16),g:parseInt(hex.slice(2,4),16),b:parseInt(hex.slice(4,6),16)};}
  match=/^rgb\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*\)$/.exec(value);
  if(match&&match.slice(1).every(x=>Number(x)<=255))return {r:Number(match[1]),g:Number(match[2]),b:Number(match[3])};
  invalid('only solid color fills are supported');
}
function primitive(tag,a){
  if(tag==='path')return a.d||'';
  const x=number(a.x),y=number(a.y),w=number(a.width),h=number(a.height);
  if(tag==='rect'){if(w<=0||h<=0)invalid('invalid rectangle');const rx=Math.min(w/2,number(a.rx,number(a.ry))),ry=Math.min(h/2,number(a.ry,number(a.rx)));if(rx<0||ry<0)invalid('invalid corner radius');if(rx&&ry)return `M${x+rx} ${y}h${w-2*rx}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${h-2*ry}a${rx} ${ry} 0 0 1 ${-rx} ${ry}h${2*rx-w}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${2*ry-h}a${rx} ${ry} 0 0 1 ${rx} ${-ry}z`;return `M${x} ${y}h${w}v${h}h${-w}z`;}
  if(tag==='polygon'||tag==='polyline')return `M${a.points||''}z`;
  if(tag==='circle'||tag==='ellipse'){const cx=number(a.cx),cy=number(a.cy),rx=number(a.rx,number(a.r)),ry=number(a.ry,number(a.r));return `M${cx-rx} ${cy}a${rx} ${ry} 0 1 0 ${2*rx} 0a${rx} ${ry} 0 1 0 ${-2*rx} 0z`;}
  invalid(`unsupported ${tag}`);
}

// Produce one bounded representation for SVG rendering and Photoshop shapes.
export function normalizeVector(svg, { width, height, inputWidth = width, inputHeight = height, contentWidth = inputWidth, contentHeight = inputHeight }) {
  if(svg.length>8*1024*1024)invalid('file too large');
  const shapes=[],stack=[];let root=false,knots=0;
  const parser=new SaxesParser({xmlns:false});
  parser.on('doctype',()=>invalid('DOCTYPE is prohibited'));
  parser.on('processinginstruction',({target})=>{if(target!=='xml')invalid('processing instructions are prohibited');});
  parser.on('opentag',node=>{
    if(stack.length>=64)invalid('group nesting exceeds safe limits');
    const tag=node.name,a=node.attributes;
    if(Object.keys(a).some(key=>/^on/i.test(key)||/(?:^|:)href$|^src$/.test(key)))invalid('active content is prohibited');
    if(tag==='svg'){
      if(root)invalid('nested SVG is unsupported');root=true;
      if(a.stroke&&a.stroke!=='none'||a.filter||a.mask||a['clip-path']||a.style&&!/^\s*display\s*:\s*block\s*;?\s*$/i.test(a.style))invalid('unsupported SVG root effects');
      const vb=(a.viewBox||`0 0 ${a.width} ${a.height}`).trim().split(/[ ,]+/).map(Number);
      if(vb.length!==4||vb.some(n=>!Number.isFinite(n))||vb[2]<=0||vb[3]<=0)invalid('invalid viewBox');
      if(a.preserveAspectRatio!=='none'&&Math.abs(vb[2]/vb[3]-inputWidth/inputHeight)>.001)invalid('unsupported aspect-ratio mapping');
      const sx=inputWidth/vb[2]*width/contentWidth,sy=inputHeight/vb[3]*height/contentHeight;
      stack.push({matrix:multiply([sx,0,0,sy,-vb[0]*sx,-vb[1]*sy],matrix(a.transform)),fill:a.fill||'black',opacity:number(a.opacity,1),fillOpacity:number(a['fill-opacity'],1),rule:a['fill-rule']==='evenodd'?'even-odd':'non-zero'});return;
    }
    if(!stack.length)invalid('missing SVG root');
    const parent=stack.at(-1),state={...parent,inDefinitions:parent.inDefinitions||tag==='defs',matrix:multiply(parent.matrix,matrix(a.transform)),fill:a.fill??parent.fill,opacity:parent.opacity*number(a.opacity,1),fillOpacity:number(a['fill-opacity'],parent.fillOpacity),rule:a['fill-rule']==='evenodd'?'even-odd':a['fill-rule']==='nonzero'?'non-zero':parent.rule};
    if(state.inDefinitions){stack.push(state);return;}
    if(a.stroke&&a.stroke!=='none'||a['clip-path']||a.mask||a.filter||a.style)invalid('strokes, effects and styles must be expanded before shape export');
    stack.push(state);
    if(tag==='g'||tag==='title'||tag==='desc')return;
    const fill=color(state.fill);if(!fill)return;
    const pathData=primitive(tag,a);if(pathData.length>2*1024*1024)invalid('path complexity exceeds safe limits');
    const path=svgpath(pathData).abs().unshort().unarc().matrix(state.matrix).abs();
    if(path.err)invalid('invalid path');
    const segments=[];path.iterate(s=>{if(s.slice(1).some(n=>!Number.isFinite(n)||Math.abs(n)>1e8))invalid('invalid coordinates');segments.push(s);if(segments.length>VECTOR_LIMITS.knots)invalid('path complexity exceeds safe limits');});
    const paths=bezierPaths(segments,state.rule);knots+=paths.reduce((sum,p)=>sum+p.knots.length,0);
    const opacity=state.opacity*state.fillOpacity;if(!Number.isFinite(opacity)||opacity<0||opacity>1)invalid('invalid opacity');
    shapes.push({fill,opacity,paths,d:path.toString()});
    if(shapes.length>VECTOR_LIMITS.paths||knots>VECTOR_LIMITS.knots)invalid('shape complexity exceeds export limits');
  });
  parser.on('closetag',()=>stack.pop());
  parser.write(svg).close();
  if(!root||!shapes.length)invalid('no supported filled shapes');
  return {version:1,width,height,shapes,pathCount:shapes.length,knotCount:knots};
}

function bezierPaths(segments,fillRule){
  const paths=[];let path,point=[0,0];
  const knot=p=>({linked:false,points:[...p,...p,...p]});
  const finish=()=>{if(path?.knots.length>1)paths.push(path);path=null;};
  for(const s of segments){const cmd=s[0].toUpperCase();
    if(cmd==='M'){finish();point=s.slice(1);path={open:false,operation:'combine',fillRule,knots:[knot(point)]};}
    else if(cmd==='Z'){finish();}
    else{
      if(!path)invalid('path starts without move');
      let end,first,second;
      if(cmd==='C'){first=s.slice(1,3);second=s.slice(3,5);end=s.slice(5,7);}
      else if(cmd==='Q'){end=s.slice(3,5);first=[point[0]+2/3*(s[1]-point[0]),point[1]+2/3*(s[2]-point[1])];second=[end[0]+2/3*(s[1]-end[0]),end[1]+2/3*(s[2]-end[1])];}
      else if(cmd==='L')end=s.slice(1);
      else if(cmd==='H')end=[s[1],point[1]];
      else if(cmd==='V')end=[point[0],s[1]];
      else invalid('unsupported path command');
      if(first)path.knots.at(-1).points.splice(4,2,...first);
      const next=knot(end);if(second)next.points.splice(0,2,...second);path.knots.push(next);point=end;
    }
  }finish();return paths;
}
export function vectorSvg(doc){return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.width}" height="${doc.height}" viewBox="0 0 ${doc.width} ${doc.height}">${doc.shapes.map(s=>`<path fill="rgb(${s.fill.r},${s.fill.g},${s.fill.b})" opacity="${s.opacity}" fill-rule="${s.paths[0]?.fillRule==='even-odd'?'evenodd':'nonzero'}" d="${s.d}"/>`).join('')}</svg>`;}
export function vectorPsdChildren(doc, placement, name){
  return doc.shapes.map((shape,index)=>({name:`${name} · Shape ${index+1}`,opacity:shape.opacity,vectorFill:{type:'color',color:shape.fill},vectorMask:{paths:shape.paths.map(path=>({...path,knots:path.knots.map(k=>({...k,points:k.points.map((value,i)=>value*placement.scale+(i%2?placement.y:placement.x))}))}))}}));
}
