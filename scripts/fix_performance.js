const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// FIX 1: Add loading="lazy" to ALL decorative/secondary img tags in the pipeline
// Only the primary "Image Reference" node should load eagerly (it's visible on load)
// All others (dummy nodes, intermediate nodes) should be lazy

// Add loading="lazy" and decoding="async" to all img tags that don't already have it
// We target imgs inside node-content (pipeline nodes), not the logo etc.
let count = 0;
// Match img tags that have src={proxy...} but no loading= attribute
content = content.replace(
  /<img src=\{proxy(Original|Generated|Upscaled|Svg)\} alt="([^"]+)" style=\{([^}]+)\}([^/]*)\/>/g,
  (match, proxyType, alt, styleContent, rest) => {
    if (match.includes('loading=')) return match; // already has it
    count++;
    // The Image Reference (alt="Reference") stays eager; rest are lazy
    const loading = alt === 'Reference' ? 'eager' : 'lazy';
    return `<img src={proxy${proxyType}} alt="${alt}" style={{${styleContent}}} loading="${loading}" decoding="async" />`;
  }
);

console.log(`FIX 1: Added lazy/eager loading to ${count} img tags`);

// FIX 2: Cap the consoleLogs array so it never grows beyond 100 entries
// This prevents unbounded memory growth in long sessions
content = content.replace(
  /setConsoleLogs\(prev => \[\.\.\.prev,/g,
  'setConsoleLogs(prev => [...prev.slice(-99),'
);

const capCount = (content.match(/prev\.slice\(-99\)/g) || []).length;
console.log(`FIX 2: Capped consoleLogs to 100 entries in ${capCount} places`);

fs.writeFileSync(filePath, content);
console.log('Done!');
