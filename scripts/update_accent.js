const fs = require('fs');
let js = fs.readFileSync('src/app/workspace/[id]/page.js', 'utf8');

js = js.replace(/'#FFD700'/g, "'var(--accent)'");
js = js.replace(/'#FFA500'/g, "'var(--accent)'");
// Notice section:
js = js.replace(/border: '1px solid #FFD700'/g, "border: '1px solid var(--accent)'");
js = js.replace(/color: '#FFD700'/g, "color: 'var(--accent)'");

fs.writeFileSync('src/app/workspace/[id]/page.js', js);
console.log('page.js accent colors updated');
