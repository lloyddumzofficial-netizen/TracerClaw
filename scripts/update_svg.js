const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

const defs = `
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                <defs>
                  <linearGradient id="activeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="50%" stopColor="rgba(255, 215, 0, 1)" />
                    <stop offset="100%" stopColor="transparent" />
                    <animate attributeName="x1" from="-100%" to="100%" dur="1.2s" repeatCount="indefinite" />
                    <animate attributeName="x2" from="0%" to="200%" dur="1.2s" repeatCount="indefinite" />
                  </linearGradient>
                  <linearGradient id="completedGlow" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="transparent" />
                    <stop offset="50%" stopColor="rgba(45, 212, 191, 0.5)" />
                    <stop offset="100%" stopColor="transparent" />
                    <animate attributeName="x1" from="-100%" to="100%" dur="3s" repeatCount="indefinite" />
                    <animate attributeName="x2" from="0%" to="200%" dur="3s" repeatCount="indefinite" />
                  </linearGradient>
                </defs>

                {/* --- Base Tracks (Dark Wire) --- */}
                <path d="M 380 700 C 440 700, 440 350, 500 350" className="svg-track" />
                <path d="M 380 700 C 440 700, 440 1050, 500 1050" className="svg-track" />
                <path d="M 380 700 C 600 700, 600 700, 850 700" className="svg-track" />
                <path d="M 720 350 C 780 350, 780 700, 850 700" className="svg-track" />
                <path d="M 720 1050 C 780 1050, 780 700, 850 700" className="svg-track" />
                <path d="M 1130 700 C 1190 700, 1190 350, 1250 350" className="svg-track" />
                <path d="M 1130 700 C 1300 700, 1300 700, 1600 700" className="svg-track" />
                <path d="M 1470 350 C 1530 350, 1530 700, 1600 700" className="svg-track" />
                <path d="M 1880 700 C 1940 700, 1940 350, 2000 350" className="svg-track" />
                <path d="M 1880 700 C 1940 700, 1940 1050, 2000 1050" className="svg-track" />
                <path d="M 1880 700 C 2100 700, 2100 700, 2350 700" className="svg-track" />
                <path d="M 2220 350 C 2280 350, 2280 700, 2350 700" className="svg-track" />
                <path d="M 2220 1050 C 2280 1050, 2280 700, 2350 700" className="svg-track" />

                {/* --- Glowing Overlays --- */}
`;

// Extract the original SVG section to replace it
const svgStart = content.indexOf('<svg style={{ position: \'absolute\'');
const svgEnd = content.indexOf('</svg>', svgStart) + 6;

if (svgStart !== -1 && svgEnd !== -1) {
  let oldSvg = content.substring(svgStart, svgEnd);
  // Keep the glowing paths by replacing <svg...> with defs and track, then leaving the original paths
  let newSvg = oldSvg.replace(/<svg style={{ position: 'absolute'[^>]*>/, defs);
  
  content = content.substring(0, svgStart) + newSvg + content.substring(svgEnd);
  fs.writeFileSync(filePath, content);
  console.log('Update complete!');
} else {
  console.log('Could not find SVG block!');
}
