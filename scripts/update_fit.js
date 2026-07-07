const fs = require('fs');
let js = fs.readFileSync('src/app/workspace/[id]/page.js', 'utf8');

js = js.replace(/objectFit: 'contain'/g, "objectFit: 'cover', borderRadius: '4px'");

fs.writeFileSync('src/app/workspace/[id]/page.js', js);
console.log('Images set to cover');
