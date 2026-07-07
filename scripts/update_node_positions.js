const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace objectFit: 'cover' back to 'contain' in the pipeline container
const pipelineStart = content.indexOf('<div \n              ref={pipelineRef}\n              className="pipeline-container"');
const pipelineEnd = content.indexOf('{/* Right Properties Panel */}', pipelineStart);

if (pipelineStart !== -1 && pipelineEnd !== -1) {
  let pipelineStr = content.substring(pipelineStart, pipelineEnd);
  
  pipelineStr = pipelineStr.replace(/objectFit:\s*'cover'/g, "objectFit: 'contain'");
  
  // Adjust top positions for intermediate nodes to correctly align with Y=350 and Y=1050
  // Since top port will be at 130px down. Top needs to be 220 for 350.
  pipelineStr = pipelineStr.replace(/top:\s*260/g, "top: 220");
  
  // Top needs to be 920 for 1050.
  pipelineStr = pipelineStr.replace(/top:\s*960/g, "top: 920");

  // Semantic Text node needs to be top: 570 (since it had height 240, 570+130 = 700)
  pipelineStr = pipelineStr.replace(/top:\s*580,\s*width:\s*260,\s*height:\s*240/g, "top: 570, width: 260");
  
  content = content.substring(0, pipelineStart) + pipelineStr + content.substring(pipelineEnd);
  fs.writeFileSync(filePath, content);
  console.log('Update complete!');
} else {
  console.log('Could not find pipeline container boundaries.');
}
