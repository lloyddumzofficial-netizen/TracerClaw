const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

const vars = `
  const proxyOriginal = project?.original_image_url ? \`/api/proxy?url=\${encodeURIComponent(project.original_image_url)}\` : null;
  const proxyGenerated = project?.generated_image_url ? \`/api/proxy?url=\${encodeURIComponent(project.generated_image_url)}\` : null;
  const proxyUpscaled = project?.upscaled_image_url ? \`/api/proxy?url=\${encodeURIComponent(project.upscaled_image_url)}\` : null;
  const proxySvg = project?.svg_url ? \`/api/proxy?url=\${encodeURIComponent(project.svg_url)}\` : null;
`;

// Insert the vars right before they are used, e.g. after 'const isSavingCrop = false;' or inside the main component
content = content.replace(/const \[isSavingCrop, setIsSavingCrop\] = useState\(false\);/, 'const [isSavingCrop, setIsSavingCrop] = useState(false);\n' + vars);

// Replace all usages of the template literal strings with the variables
content = content.replace(/`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.original_image_url\)\}`/g, 'proxyOriginal');
content = content.replace(/`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.generated_image_url\)\}`/g, 'proxyGenerated');
content = content.replace(/`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.upscaled_image_url\)\}`/g, 'proxyUpscaled');
content = content.replace(/`\/api\/proxy\?url=\$\{encodeURIComponent\(project\.svg_url\)\}`/g, 'proxySvg');

fs.writeFileSync(filePath, content);
console.log('Restored proxy caching logic!');
