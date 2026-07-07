const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Replace the old connector divs with the new elegant ones
content = content.replace(/\{\/\* CONNECTOR 1 \*\/\}\s*<div className=\{`node-connector \$\{traceState === 'step1' \? 'active' : ''\}`\}><\/div>/, 
`{/* CONNECTOR 1 */}
              <div className={\`elegant-connector \${traceState === 'step1' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`}>
                <div className="elegant-arrow"></div>
              </div>`);

content = content.replace(/\{\/\* CONNECTOR 2 \*\/\}\s*<div className=\{`node-connector \$\{traceState === 'step2' \? 'active' : ''\}`\}><\/div>/, 
`{/* CONNECTOR 2 */}
              <div className={\`elegant-connector \${traceState === 'step2' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`}>
                <div className="elegant-arrow"></div>
              </div>`);

content = content.replace(/\{\/\* CONNECTOR 3 \*\/\}\s*<div className=\{`node-connector \$\{traceState === 'step3' \? 'active' : ''\}`\}><\/div>/, 
`{/* CONNECTOR 3 */}
              <div className={\`elegant-connector \${traceState === 'step3' ? 'active' : (project.svg_url ? 'completed' : '')}\`}>
                <div className="elegant-arrow"></div>
              </div>`);

// Remove the checkerboard pattern when there's no image
content = content.replace(/className="node-content checkerboard"/g, 'className="node-content"');

fs.writeFileSync(filePath, content);
console.log('page.js updated successfully!');
