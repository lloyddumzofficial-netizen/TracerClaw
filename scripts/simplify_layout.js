const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Find the start of the pipeline container children
const svgStartIdx = content.indexOf('<svg style={{ position: \'absolute\'');
const node4EndIdx = content.indexOf('</div>', content.indexOf('TrueVector™ Auto-Bezier Core')) + 6; // Rough guess, let's use exact line match instead.

// It's safer to extract the exact components from the old code to preserve their inner contents!
function extractNode(marker) {
  const start = content.lastIndexOf('<div', content.indexOf(marker));
  // Find matching closing div
  let openDivs = 0;
  let end = start;
  while (end < content.length) {
    if (content.substr(end, 4) === '<div') openDivs++;
    if (content.substr(end, 5) === '</div') openDivs--;
    end++;
    if (openDivs === 0) break;
  }
  return content.substring(start, end + 5);
}

// Extract the 4 main nodes
let node1 = extractNode('Image Reference');
let node2 = extractNode('DesaynVision™ Neural Extractor v3.0');
let node3 = extractNode('ClawScale™ Ultra-Res Matrix');
let node4 = extractNode('TrueVector™ Auto-Bezier Core');

// Update their absolute positions!
node1 = node1.replace(/left: [0-9]+, top: [0-9]+/, 'left: 100, top: 750');
node2 = node2.replace(/left: [0-9]+, top: [0-9]+/, 'left: 600, top: 750');
node3 = node3.replace(/left: [0-9]+, top: [0-9]+/, 'left: 1100, top: 750');
node4 = node4.replace(/left: [0-9]+, top: [0-9]+/, 'left: 1600, top: 750');

// The new SVG block
const newSvg = `
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                <defs>
                  <linearGradient id="activeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="50%" stopColor="rgba(255, 215, 0, 1)" />
                    <stop offset="100%" stopColor="transparent" />
                    <animate attributeName="x1" from="-100%" to="100%" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="x2" from="0%" to="200%" dur="1.2s" repeatCount="indefinite" />
                  </linearGradient>
                  <linearGradient id="completedGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="50%" stopColor="rgba(45, 212, 191, 0.5)" />
                    <stop offset="100%" stopColor="transparent" />
                    <animate attributeName="x1" from="-100%" to="100%" dur="3s" repeatCount="indefinite" />
                    <animate attributeName="x2" from="0%" to="200%" dur="3s" repeatCount="indefinite" />
                  </linearGradient>
                </defs>

                {/* --- Base Tracks (Dark Wire) --- */}
                <path d="M 380 880 C 490 880, 490 880, 600 880" className="svg-track" />
                <path d="M 880 880 C 990 880, 990 880, 1100 880" className="svg-track" />
                <path d="M 1380 880 C 1490 880, 1490 880, 1600 880" className="svg-track" />

                {/* --- Glowing Overlays --- */}
                {/* Step 1 */}
                <path d="M 380 880 C 490 880, 490 880, 600 880" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                {/* Step 2 */}
                <path d="M 880 880 C 990 880, 990 880, 1100 880" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                {/* Step 3 */}
                <path d="M 1380 880 C 1490 880, 1490 880, 1600 880" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
              </svg>
`;

const newBlock = newSvg + '\n\n' + node1 + '\n\n' + node2 + '\n\n' + node3 + '\n\n' + node4 + '\n\n';

// Replace everything between <svg> and {/* end zoom wrapper */}
const startReplacement = content.indexOf('<svg style={{ position: \'absolute\'');
const endReplacement = content.indexOf('{/* end zoom wrapper */}');

if (startReplacement !== -1 && endReplacement !== -1) {
  content = content.substring(0, startReplacement) + newBlock + '            ' + content.substring(endReplacement);
} else {
  console.error("Could not find replacement boundaries.");
  process.exit(1);
}

// Update the container width/height
content = content.replace(/width: '3200px'/, "width: '2000px'");
content = content.replace(/height: '2000px'/, "height: '1500px'");

fs.writeFileSync(filePath, content);
console.log('Successfully refactored to Clean 4-Node Pipeline!');
