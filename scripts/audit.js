const fs = require('fs');

const cssBytes = fs.statSync('src/app/globals.css').size;
const jsBytes = fs.statSync('src/app/workspace/[id]/page.js').size;

console.log('=== ASSET SIZE ANALYSIS ===');
console.log('page.js:', (jsBytes / 1024).toFixed(1), 'KB');
console.log('globals.css:', (cssBytes / 1024).toFixed(1), 'KB');

const pageContent = fs.readFileSync('src/app/workspace/[id]/page.js', 'utf8');
const nodeCards = (pageContent.match(/node-card/g) || []).length;
const svgPaths = (pageContent.match(/<path /g) || []).length;
const cssFilters = (pageContent.match(/filter:/g) || []).length;
const imgTags = (pageContent.match(/<img /g) || []).length;
const imgLazy = (pageContent.match(/loading="lazy"/g) || []).length;
const consoleLogs = (pageContent.match(/setConsoleLogs/g) || []).length;

console.log('');
console.log('=== DOM COMPLEXITY ===');
console.log('node-card references:', nodeCards);
console.log('SVG path elements (wires):', svgPaths);
console.log('CSS filter effects on imgs:', cssFilters);
console.log('img tags total:', imgTags);
console.log('lazy-loaded images:', imgLazy, '(of', imgTags, ')');
console.log('console log state updates:', consoleLogs);
console.log('');
console.log('=== RISKS ===');
console.log('- Images WITHOUT lazy loading:', imgTags - imgLazy);
console.log('- CSS filters on dummy nodes (GPU compositing cost):', cssFilters);
console.log('- consoleLogs state (unbounded array, grows forever):', consoleLogs, 'setters');
