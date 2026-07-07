const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// =============================================
// STRATEGY: Bring satellite nodes closer to main row
// Main row: SVG Y=880, CSS top=750
// Top satellites: SVG Y 280 -> 630, CSS top 150 -> 500
// Bottom satellites: SVG Y 1480 -> 1130, CSS top 1350 -> 1000
// =============================================

// 1. Fix CSS top positions for satellite nodes (only match the ones at exact positions)
//    top: 150 -> top: 500 (top satellites)
content = content.replace(/\bstyle={{ position: "absolute", left: 500, top: 150,/g,
  'style={{ position: "absolute", left: 500, top: 500,');
//    top: 1350 -> top: 1000 (bottom satellites)
content = content.replace(/\bstyle={{ position: "absolute", left: 500, top: 1350,/g,
  'style={{ position: "absolute", left: 500, top: 1000,');
// Also fix the stage 2 & 3 top/bottom intermediate nodes
content = content.replace(/\bstyle={{ position: "absolute", left: 2000, top: 150,/g,
  'style={{ position: "absolute", left: 2000, top: 500,');
content = content.replace(/\bstyle={{ position: "absolute", left: 2000, top: 1350,/g,
  'style={{ position: "absolute", left: 2000, top: 1000,');

// 2. Fix SVG path coordinates — only the satellite Y values (280 and 1480)
// We target them surgically: " 280" -> " 630" and " 1480" -> " 1130"
// These ONLY appear in SVG paths (no other numeric context)

// Parse the SVG block to be safe
const svgStartIdx = content.indexOf('<svg style=');
const svgEndIdx = content.indexOf('</svg>') + '</svg>'.length;

if (svgStartIdx !== -1 && svgEndIdx !== -1) {
  let svgBlock = content.substring(svgStartIdx, svgEndIdx);
  
  // Replace top satellite Y coordinate: 280 -> 630
  svgBlock = svgBlock.replace(/ 280/g, ' 630');
  // Replace bottom satellite Y coordinate: 1480 -> 1130
  svgBlock = svgBlock.replace(/ 1480/g, ' 1130');
  
  content = content.substring(0, svgStartIdx) + svgBlock + content.substring(svgEndIdx);
  console.log('SVG block updated.');
}

// 3. Also check and fix lines that use top: 150 or top: 1350 for other nodes at 1250 and 2000
// Search any remaining references
const check150 = (content.match(/top: 150/g) || []).length;
const check1350 = (content.match(/top: 1350/g) || []).length;
console.log(`Remaining top: 150 occurrences: ${check150}`);
console.log(`Remaining top: 1350 occurrences: ${check1350}`);

// Replace any remaining intermediate nodes at top:150 / top:1350
content = content.replace(/top: 150,/g, 'top: 500,');
content = content.replace(/top: 1350,/g, 'top: 1000,');

fs.writeFileSync(filePath, content);
console.log('Layout tightened! Satellite nodes are now ±250px from main row.');
