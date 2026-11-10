import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { isCompleteDesignProject, MAX_SELECTION_SHAPES, nextSelectionShapes, validateEditInstructions } from "@/lib/artworkEdits";
import { buildEditMasks, sourcePixels, compositeEdit, referenceImage } from "@/server/artworkEdits/images";
import { EDIT_REGION_COLORS } from "@/server/artworkEdits/regionColors";

const rect = (x = .2, y = .2, width = .3, height = .3) => ({ kind: "rect", x, y, width, height });
const instruction = shapes => ({ prompt: "Remove this text", shapes });
describe("selective artwork edits", () => {
  it("is limited to complete-design projects, including legacy preserve defaults", () => {
    expect(isCompleteDesignProject({trace_type:"mockup_preserve",ai_prompt:"PRESERVE_LOGOS"})).toBe(true);
    expect(isCompleteDesignProject({trace_type:"standard"})).toBe(true);
    for (const project of [{trace_type:"mockup_erase"},{trace_type:"standard",ai_prompt:"ERASE_LOGOS"},{trace_type:"logo",ai_prompt:"PRESERVE_LOGOS"},{trace_type:"pattern"}]) expect(isCompleteDesignProject(project)).toBe(false);
  });
  it("accepts 1–5 instructions and rejects malformed/empty/excessive requests", () => {
    for (let n = 1; n <= 5; n++) expect(validateEditInstructions(Array.from({ length: n }, () => instruction([rect()])))).toHaveLength(n);
    for (const value of [[], Array(6).fill(instruction([rect()])), [{ prompt: "", shapes: [rect()] }], [instruction([])], [instruction([rect(.9)])], [instruction([{ kind: "brush", radius: .02, points: [{ x: NaN, y: .1 }] }])]]) expect(() => validateEditInstructions(value)).toThrow();
  });
  it("redrawing replaces the previous rectangle instead of accumulating boxes", () => {
    let shapes=[];
    for(let n=0;n<25;n++) shapes=nextSelectionShapes(shapes,rect(n/100));
    expect(shapes).toHaveLength(1);expect(shapes[0].x).toBe(.24);
    expect(()=>validateEditInstructions([instruction([rect(),rect(.6)])])).toThrow("one rectangle");
  });
  it("caps brush strokes and point complexity before paid submission", () => {
    const stroke={kind:"brush",radius:.02,points:[{x:.5,y:.5}]};
    expect(()=>nextSelectionShapes(Array(MAX_SELECTION_SHAPES).fill(stroke),stroke)).toThrow("limit");
    expect(()=>validateEditInstructions([instruction(Array(MAX_SELECTION_SHAPES+1).fill(stroke))])).toThrow("too many strokes");
    expect(()=>validateEditInstructions([instruction([{...stroke,points:Array(401).fill({x:.5,y:.5})}])])).toThrow("complex");
  });
  it("rejects instruction overlap and selections erased completely", async () => {
    await expect(buildEditMasks([instruction([rect()]), instruction([rect()])], 80, 80)).rejects.toThrow("overlap");
    await expect(buildEditMasks([instruction([{ kind: "brush", radius: .1, points: [{ x: .5, y: .5 }] }, { kind: "brush", radius: .2, points: [{ x: .5, y: .5 }], erase: true }])], 80, 80)).rejects.toThrow("larger");
  });
  it("keeps every channel outside brush/rectangle masks byte-identical, including erased holes", async () => {
    const original = await sharp({ create: { width: 80, height: 60, channels: 4, background: { r: 30, g: 80, b: 110, alpha: .7 } } }).png().toBuffer();
    const generated = await sharp({ create: { width: 120, height: 120, channels: 4, background: "red" } }).png().toBuffer();
    const source = await sourcePixels(original);
    const { union } = await buildEditMasks([instruction([rect(.1,.1,.2,.2)]), instruction([{ kind: "brush", radius: .1, points: [{ x: .7, y: .5 }, { x: .8, y: .6 }] }, { kind: "brush", radius: .03, points: [{ x: .7, y: .5 }], erase: true }])], 80, 60);
    const result = await sourcePixels(await compositeEdit(source, generated, union));
    expect([result.width,result.height]).toEqual([80,60]);
    let changed = 0;
    for (let p=0;p<union.length;p++) {
      if (!union[p]) expect(result.data.subarray(p*4,p*4+4)).toEqual(source.data.subarray(p*4,p*4+4));
      else if (result.data[p*4] !== source.data[p*4]) changed++;
    }
    expect(changed).toBeGreaterThan(50);
  });
  it.each([1, 2, 5])("renders %i color-only reference regions with no added glyphs, badges, or outside pixels", async count => {
    const width=240,height=120;
    const source=await sourcePixels(await sharp(Buffer.from(`<svg width="${width}" height="${height}"><rect width="100%" height="100%" fill="#26314a" fill-opacity=".7"/><text x="70" y="60" fill="white" font-size="30">24</text></svg>`)).png().toBuffer());
    const rows=Array.from({length:count},(_,index)=>instruction([rect(.02+index*.19,.3,.12,.3)]));
    // Include a brush selection with an erased hole. Guide tint must follow
    // the actual raster mask, not paint across its bounding rectangle.
    rows[count-1]=instruction([{kind:"brush",radius:.07,points:[{x:.08+(count-1)*.19,y:.5}]},{kind:"brush",radius:.02,points:[{x:.08+(count-1)*.19,y:.5}],erase:true}]);
    const {masks}=await buildEditMasks(rows,width,height);
    const expected=Buffer.from(source.data);
    masks.forEach((mask,index)=>{
      for(let p=0;p<mask.length;p++){
        const alpha=.4*mask[p]/255;
        for(let c=0;c<3;c++)expected[p*4+c]=Math.round(expected[p*4+c]*(1-alpha)+EDIT_REGION_COLORS[index].rgb[c]*alpha);
      }
    });
    const actual=await sourcePixels(await referenceImage(source,masks));
    expect([actual.width,actual.height]).toEqual([width,height]);
    expect(actual.data.equals(expected)).toBe(true);
  });
});
