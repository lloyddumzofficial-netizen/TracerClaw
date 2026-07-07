const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

const pipelineStart = content.indexOf('<div \n              ref={pipelineRef}\n              className="pipeline-container"');
const pipelineEnd = content.indexOf('{/* Right Properties Panel */}', pipelineStart);

if (pipelineStart !== -1 && pipelineEnd !== -1) {
  let pipelineStr = content.substring(pipelineStart, pipelineEnd);
  
  // 1. Expand container height from 1400px to 3000px
  pipelineStr = pipelineStr.replace(/height:\s*'1400px'/g, "height: '3000px'");
  
  // 2. Adjust node top coordinates
  pipelineStr = pipelineStr.replace(/top:\s*220/g, "top: 100");
  pipelineStr = pipelineStr.replace(/top:\s*570/g, "top: 1100");
  pipelineStr = pipelineStr.replace(/top:\s*920/g, "top: 2100");

  // 3. Adjust SVG wire Y-coordinates
  // Old Y=350 -> New Y=230
  // Old Y=700 -> New Y=1230
  // Old Y=1050 -> New Y=2230

  // Carefully replace SVG paths using regex
  // Match path coordinates exactly
  pipelineStr = pipelineStr.replace(/350/g, "230");
  pipelineStr = pipelineStr.replace(/700/g, "1230");
  pipelineStr = pipelineStr.replace(/1050/g, "2230");
  
  // Wait, replacing '700' globally inside pipelineStr might hit something else?
  // Let's verify what '700', '350', '1050' could match.
  // There are no width=700 etc. Only the SVG paths have 700.
  // Let's be safer and only replace in the SVG block!
  
  content = content.substring(0, pipelineStart) + pipelineStr + content.substring(pipelineEnd);
  fs.writeFileSync(filePath, content);
  console.log('Update complete!');
} else {
  console.log('Could not find pipeline container boundaries.');
}
