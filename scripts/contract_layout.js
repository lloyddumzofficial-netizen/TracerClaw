const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

const pipelineStart = content.indexOf('<div \n              ref={pipelineRef}\n              className="pipeline-container"');
const pipelineEnd = content.indexOf('{/* Right Properties Panel */}', pipelineStart);

if (pipelineStart !== -1 && pipelineEnd !== -1) {
  let pipelineStr = content.substring(pipelineStart, pipelineEnd);
  
  // 1. Adjust container height back to a reasonable 2000px
  pipelineStr = pipelineStr.replace(/height:\s*'3000px'/g, "height: '2000px'");
  
  // 2. Adjust node top coordinates
  pipelineStr = pipelineStr.replace(/top:\s*100/g, "top: 150");
  pipelineStr = pipelineStr.replace(/top:\s*1100/g, "top: 750");
  pipelineStr = pipelineStr.replace(/top:\s*2100/g, "top: 1350");

  // 3. Adjust SVG wire Y-coordinates
  // Old Y=230 -> New Y=280
  // Old Y=1230 -> New Y=880
  // Old Y=2230 -> New Y=1480

  // Replace within SVG block to be safe
  const svgStart = pipelineStr.indexOf('<svg style=');
  const svgEnd = pipelineStr.indexOf('</svg>');
  
  if (svgStart !== -1 && svgEnd !== -1) {
    let svgStr = pipelineStr.substring(svgStart, svgEnd);
    
    // Safely replace the Y coordinates
    // They appear with a space before them (e.g., " 230" or " 1230" or " 2230") or inside strings
    svgStr = svgStr.replace(/ 230/g, " 280");
    svgStr = svgStr.replace(/ 1230/g, " 880");
    svgStr = svgStr.replace(/ 2230/g, " 1480");
    
    pipelineStr = pipelineStr.substring(0, svgStart) + svgStr + pipelineStr.substring(svgEnd);
  }
  
  content = content.substring(0, pipelineStart) + pipelineStr + content.substring(pipelineEnd);
  fs.writeFileSync(filePath, content);
  console.log('Update complete!');
} else {
  console.log('Could not find pipeline container boundaries.');
}
