const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// The OLD layout constants (what's currently in the file)
const oldCols = [100, 600, 1100, 1600, 2100, 2600, 3100];
const oldYTop = 200;
const oldYMid = 750;
const oldYBot = 1300;
const oldSyTop = 330;
const oldSyMid = 880;
const oldSyBot = 1430;

// The NEW layout constants (compressed but safe)
// Gap of 160px between columns
const newCols = [100, 520, 940, 1360, 1780, 2200, 2620];
const newYTop = 250;
const newYMid = 750;
const newYBot = 1250;
const newSyTop = 380; // 250 + 130
const newSyMid = 880; // 750 + 130
const newSyBot = 1380; // 1250 + 130

// Helper to generate a nice bezier path
function getPath(x1, y1, x2, y2) {
  const hx = x1 + (x2 - x1) / 2; // halfway point
  return `M ${x1} ${y1} C ${hx} ${y1}, ${hx} ${y2}, ${x2} ${y2}`;
}

// Re-write the SVG block completely
const newSvgPaths = `                {/* --- Base Tracks (Dark Wire) --- */}
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyTop)}" className="svg-track" />
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyBot)}" className="svg-track" />
                
                <path d="${getPath(newCols[1]+280, newSyTop, newCols[2], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[1]+280, newSyMid, newCols[2], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[1]+280, newSyBot, newCols[2], newSyMid)}" className="svg-track" />
                
                <path d="${getPath(newCols[2]+280, newSyMid, newCols[3], newSyTop)}" className="svg-track" />
                <path d="${getPath(newCols[2]+280, newSyMid, newCols[4], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[3]+280, newSyTop, newCols[4], newSyMid)}" className="svg-track" />
                
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[5], newSyTop)}" className="svg-track" />
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[5], newSyBot)}" className="svg-track" />
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[6], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[5]+280, newSyTop, newCols[6], newSyMid)}" className="svg-track" />
                <path d="${getPath(newCols[5]+280, newSyBot, newCols[6], newSyMid)}" className="svg-track" />

                {/* --- Glowing Overlays --- */}
                {/* Step 1 */}
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyTop)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(newCols[0]+280, newSyMid, newCols[1], newSyBot)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(newCols[1]+280, newSyTop, newCols[2], newSyMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(newCols[1]+280, newSyMid, newCols[2], newSyMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(newCols[1]+280, newSyBot, newCols[2], newSyMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                
                {/* Step 2 */}
                <path d="${getPath(newCols[2]+280, newSyMid, newCols[3], newSyTop)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[2]+280, newSyMid, newCols[4], newSyMid)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[3]+280, newSyTop, newCols[4], newSyMid)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                
                {/* Step 3 */}
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[5], newSyTop)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[5], newSyBot)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[4]+280, newSyMid, newCols[6], newSyMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[5]+280, newSyTop, newCols[6], newSyMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(newCols[5]+280, newSyBot, newCols[6], newSyMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
`;

// Replace SVG block
const svgStartIdx = content.indexOf('{/* --- Base Tracks (Dark Wire) --- */}');
const svgEndIdx = content.indexOf('</svg>', svgStartIdx);
if (svgStartIdx !== -1 && svgEndIdx !== -1) {
  content = content.substring(0, svgStartIdx) + newSvgPaths + content.substring(svgEndIdx);
}

// Replace node positions programmatically by matching their OLD ones
// Col 0
content = content.replace(new RegExp("left: " + oldCols[0] + ", top: " + oldYMid, 'g'), "left: " + newCols[0] + ", top: " + newYMid);
// Step 1
content = content.replace(new RegExp("left: " + oldCols[1] + ", top: " + oldYTop, 'g'), "left: " + newCols[1] + ", top: " + newYTop);
content = content.replace(new RegExp("left: " + oldCols[1] + ", top: " + oldYMid, 'g'), "left: " + newCols[1] + ", top: " + newYMid);
content = content.replace(new RegExp("left: " + oldCols[1] + ", top: " + oldYBot, 'g'), "left: " + newCols[1] + ", top: " + newYBot);
// Main 1
content = content.replace(new RegExp("left: " + oldCols[2] + ", top: " + oldYMid, 'g'), "left: " + newCols[2] + ", top: " + newYMid);
// Step 2
content = content.replace(new RegExp("left: " + oldCols[3] + ", top: " + oldYTop, 'g'), "left: " + newCols[3] + ", top: " + newYTop);
content = content.replace(new RegExp("left: " + oldCols[4] + ", top: " + oldYMid, 'g'), "left: " + newCols[4] + ", top: " + newYMid);
// Step 3
content = content.replace(new RegExp("left: " + oldCols[5] + ", top: " + oldYTop, 'g'), "left: " + newCols[5] + ", top: " + newYTop);
content = content.replace(new RegExp("left: " + oldCols[5] + ", top: " + oldYBot, 'g'), "left: " + newCols[5] + ", top: " + newYBot);
// Main 3
content = content.replace(new RegExp("left: " + oldCols[6] + ", top: " + oldYMid, 'g'), "left: " + newCols[6] + ", top: " + newYMid);

fs.writeFileSync(filePath, content);
console.log('Layout successfully compacted and beautified!');
