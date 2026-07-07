const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

const pipelineStart = content.indexOf('<div \n              ref={pipelineRef}\n              className="pipeline-container"');
const pipelineEnd = content.indexOf('{/* Right Properties Panel */}', pipelineStart);

if (pipelineStart !== -1 && pipelineEnd !== -1) {
  let pipelineStr = content.substring(pipelineStart, pipelineEnd);
  // Replace objectFit: 'contain' with objectFit: 'cover' for all images inside the pipeline container
  pipelineStr = pipelineStr.replace(/objectFit:\s*'contain'/g, "objectFit: 'cover'");
  
  content = content.substring(0, pipelineStart) + pipelineStr + content.substring(pipelineEnd);
  fs.writeFileSync(filePath, content);
  console.log('Update complete!');
} else {
  console.log('Could not find pipeline container boundaries.');
}
