const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

let changes = 0;

// Replace all inline proxy URL constructions with the pre-computed variables
// original_image_url
content = content.replace(
  /`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.original_image_url\)\}`/g,
  (match) => { changes++; return 'proxyOriginal'; }
);

// generated_image_url
content = content.replace(
  /`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.generated_image_url\)\}`/g,
  (match) => { changes++; return 'proxyGenerated'; }
);

// upscaled_image_url
content = content.replace(
  /`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.upscaled_image_url\)\}`/g,
  (match) => { changes++; return 'proxyUpscaled'; }
);

// svg_url
content = content.replace(
  /`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.svg_url\)\}`/g,
  (match) => { changes++; return 'proxySvg'; }
);

fs.writeFileSync(filePath, content);
console.log(`Done! Replaced ${changes} inline proxy URL constructions with cached variables.`);
