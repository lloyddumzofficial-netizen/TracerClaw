const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// Fix broken style={{ -> style={{{ (double curly brace introduced by regex)
// The regex captured the content inside {{ }} and wrapped it again in {{ }}
let fixed = 0;
content = content.replace(/style=\{\{\{([^}]+)\}\}/g, (match, inner) => {
  fixed++;
  return `style={{${inner}}}`;
});

console.log(`Fixed ${fixed} double-curly-brace style attributes`);
fs.writeFileSync(filePath, content);
console.log('Done!');
