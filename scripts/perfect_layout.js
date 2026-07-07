const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// The new layout constants
const cols = [100, 600, 1100, 1600, 2100, 2600, 3100];
const yTop = 200;
const yMid = 750;
const yBot = 1300;
const syTop = 330;
const syMid = 880;
const syBot = 1430;

// Helper to generate a nice bezier path
// A gentle S-curve with handles halfway between the X coordinates
function getPath(x1, y1, x2, y2) {
  const hx = x1 + (x2 - x1) / 2; // halfway point
  return `M ${x1} ${y1} C ${hx} ${y1}, ${hx} ${y2}, ${x2} ${y2}`;
}

// Re-write the SVG block completely
const newSvgPaths = `                {/* --- Base Tracks (Dark Wire) --- */}
                <path d="${getPath(cols[0]+280, syMid, cols[1], syTop)}" className="svg-track" />
                <path d="${getPath(cols[0]+280, syMid, cols[1], syMid)}" className="svg-track" />
                <path d="${getPath(cols[0]+280, syMid, cols[1], syBot)}" className="svg-track" />
                
                <path d="${getPath(cols[1]+280, syTop, cols[2], syMid)}" className="svg-track" />
                <path d="${getPath(cols[1]+280, syMid, cols[2], syMid)}" className="svg-track" />
                <path d="${getPath(cols[1]+280, syBot, cols[2], syMid)}" className="svg-track" />
                
                <path d="${getPath(cols[2]+280, syMid, cols[3], syTop)}" className="svg-track" />
                <path d="${getPath(cols[2]+280, syMid, cols[4], syMid)}" className="svg-track" />
                <path d="${getPath(cols[3]+280, syTop, cols[4], syMid)}" className="svg-track" />
                
                <path d="${getPath(cols[4]+280, syMid, cols[5], syTop)}" className="svg-track" />
                <path d="${getPath(cols[4]+280, syMid, cols[5], syBot)}" className="svg-track" />
                <path d="${getPath(cols[4]+280, syMid, cols[6], syMid)}" className="svg-track" />
                <path d="${getPath(cols[5]+280, syTop, cols[6], syMid)}" className="svg-track" />
                <path d="${getPath(cols[5]+280, syBot, cols[6], syMid)}" className="svg-track" />

                {/* --- Glowing Overlays --- */}
                {/* Step 1 */}
                <path d="${getPath(cols[0]+280, syMid, cols[1], syTop)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(cols[0]+280, syMid, cols[1], syMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(cols[0]+280, syMid, cols[1], syBot)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(cols[1]+280, syTop, cols[2], syMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(cols[1]+280, syMid, cols[2], syMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                <path d="${getPath(cols[1]+280, syBot, cols[2], syMid)}" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                
                {/* Step 2 */}
                <path d="${getPath(cols[2]+280, syMid, cols[3], syTop)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[2]+280, syMid, cols[4], syMid)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[3]+280, syTop, cols[4], syMid)}" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                
                {/* Step 3 */}
                <path d="${getPath(cols[4]+280, syMid, cols[5], syTop)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[4]+280, syMid, cols[5], syBot)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[4]+280, syMid, cols[6], syMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[5]+280, syTop, cols[6], syMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                <path d="${getPath(cols[5]+280, syBot, cols[6], syMid)}" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
`;

// Replace SVG block
const svgStartIdx = content.indexOf('{/* --- Base Tracks (Dark Wire) --- */}');
const svgEndIdx = content.indexOf('</svg>', svgStartIdx);
if (svgStartIdx !== -1 && svgEndIdx !== -1) {
  content = content.substring(0, svgStartIdx) + newSvgPaths + content.substring(svgEndIdx);
}

// Replace node positions programmatically by matching their current ones
content = content.replace(/left: 100, top: 750/, `left: ${cols[0]}, top: ${yMid}`);
// Step 1
content = content.replace(/left: 500, top: 500/, `left: ${cols[1]}, top: ${yTop}`); // Luminance
content = content.replace(/left: 500, top: 250/, `left: ${cols[1]}, top: ${yMid}`); // Vision Encoder
content = content.replace(/left: 500, top: 1000/, `left: ${cols[1]}, top: ${yBot}`); // Frequency
// Main 1
content = content.replace(/left: 850, top: 750/, `left: ${cols[2]}, top: ${yMid}`);
// Step 2
content = content.replace(/left: 1250, top: 500/, `left: ${cols[3]}, top: ${yTop}`); // Color match
content = content.replace(/left: 1600, top: 750/, `left: ${cols[4]}, top: ${yMid}`); // Main 2
// Step 3
content = content.replace(/left: 2000, top: 500/, `left: ${cols[5]}, top: ${yTop}`); // Bezier / Anchor
content = content.replace(/left: 2000, top: 1000/, `left: ${cols[5]}, top: ${yBot}`); // TrueVector
// Main 3
content = content.replace(/left: 2230, top: 750/, `left: ${cols[6]}, top: ${yMid}`);

fs.writeFileSync(filePath, content);
console.log('Layout successfully expanded and perfected!');
