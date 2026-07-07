const fs = require('fs');
const c = fs.readFileSync('src/app/workspace/[id]/page.js', 'utf8');
const lines = c.split('\n');

const startIdx = lines.findIndex(l => l.includes('className="pipeline-container"'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('</TransformComponent>'));

console.log('Pipeline container starts at line', startIdx + 1);
console.log('Pipeline container ends at line', endIdx + 1);
