const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/app/workspace/[id]/page.js');
let content = fs.readFileSync(filePath, 'utf8');

// The new absolutely positioned graph wrapper
const graphWrapper = `
            <div 
              ref={pipelineRef}
              className="pipeline-container"
              style={{
                zoom: 1,
                willChange: 'zoom',
                transformOrigin: '0 0',
                position: 'relative',
                width: '3200px',
                height: '1400px',
                padding: 0
              }}
            >
              
              <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
                {/* Node 1 (380, 700) -> Node 2 (500, 350) */}
                <path d="M 380 700 C 440 700, 440 350, 500 350" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                {/* Node 1 (380, 700) -> Node 3 (500, 1050) */}
                <path d="M 380 700 C 440 700, 440 1050, 500 1050" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                {/* Node 1 (380, 700) -> Main 1 (850, 700) */}
                <path d="M 380 700 C 600 700, 600 700, 850 700" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                
                {/* Node 2 (720, 350) -> Main 1 (850, 700) */}
                <path d="M 720 350 C 780 350, 780 700, 850 700" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />
                {/* Node 3 (720, 1050) -> Main 1 (850, 700) */}
                <path d="M 720 1050 C 780 1050, 780 700, 850 700" className={\`svg-connector \${traceState === 'step1' ? 'active' : 'completed'}\`} />

                {/* Main 1 (1130, 700) -> Node 4 (1250, 350) */}
                <path d="M 1130 700 C 1190 700, 1190 350, 1250 350" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                {/* Main 1 (1130, 700) -> Main 2 (1600, 700) */}
                <path d="M 1130 700 C 1300 700, 1300 700, 1600 700" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />
                
                {/* Node 4 (1470, 350) -> Main 2 (1600, 700) */}
                <path d="M 1470 350 C 1530 350, 1530 700, 1600 700" className={\`svg-connector \${traceState === 'step2' ? 'active' : (project.generated_image_url ? 'completed' : '')}\`} />

                {/* Main 2 (1880, 700) -> Node 5 (2000, 350) */}
                <path d="M 1880 700 C 1940 700, 1940 350, 2000 350" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                {/* Main 2 (1880, 700) -> Node 6 (2000, 1050) */}
                <path d="M 1880 700 C 1940 700, 1940 1050, 2000 1050" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                {/* Main 2 (1880, 700) -> Main 3 (2350, 700) */}
                <path d="M 1880 700 C 2100 700, 2100 700, 2350 700" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />

                {/* Node 5 (2220, 350) -> Main 3 (2350, 700) */}
                <path d="M 2220 350 C 2280 350, 2280 700, 2350 700" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
                {/* Node 6 (2220, 1050) -> Main 3 (2350, 700) */}
                <path d="M 2220 1050 C 2280 1050, 2280 700, 2350 700" className={\`svg-connector \${traceState === 'step3' ? 'active' : (project.upscaled_image_url ? 'completed' : '')}\`} />
              </svg>
`;

// Replace pipeline-container div start
content = content.replace(/<div \s*ref=\{pipelineRef\}\s*className="pipeline-container"[\s\S]*?>/, graphWrapper);

// Remove all <div className="node-connector" ...></div> completely
content = content.replace(/{?\/\* CONNECTOR.*?<\/div>/g, '');
content = content.replace(/<div className={\`node-connector.*?><\/div>/g, '');

// Give absolute coordinates to the nodes
// 1. Source
content = content.replace(/<div className="node-card">/, '<div className="node-card" style={{ position: "absolute", left: 100, top: 570, zIndex: 10 }}>');

// 2. Dummy 1 (Luminance)
content = content.replace(/<div className="node-card intermediate-node">/, '<div className="node-card intermediate-node" style={{ position: "absolute", left: 500, top: 260, zIndex: 10 }}>');

// Add Dummy 1.5 (Edge Detect) right after Dummy 1
const dummyEdge = `
              {/* DUMMY NODE 1.5: Edge Detect */}
              <div className="node-card intermediate-node" style={{ position: "absolute", left: 500, top: 960, zIndex: 10 }}>
                <div className="node-port input"></div>
                <div className="node-header">
                  <div className="node-header-title"><Activity size={12}/> Frequency Separator</div>
                </div>
                <div className="node-content checkerboard">
                  {project.original_image_url ? (
                    <img src={\`/api/proxy?url=\${encodeURIComponent(project.original_image_url)}\`} alt="Edge" style={{width: '100%', height: '100%', objectFit: 'contain', filter: 'invert(1) contrast(300%)'}} referrerPolicy="no-referrer" decoding="async" />
                  ) : (
                    <div className="placeholder-node">Pending Input</div>
                  )}
                </div>
                <div className="node-footer" style={{ padding: '8px 12px', borderTop: '1px solid #222', fontSize: '11px', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Pre-Processing</span>
                  <span style={{ color: traceState === 'step1' ? '#FFD700' : project.original_image_url ? '#4ade80' : '#555' }}>
                    {traceState === 'step1' ? '▶ Processing...' : project.original_image_url ? '✓ Active' : '○ Standby'}
                  </span>
                </div>
                <div className="node-port output"></div>
              </div>
`;
content = content.replace(/(Luminance Extractor[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/, '$1' + dummyEdge);


// 3. Gemini Main
content = content.replace(/<div className={\`node-card \${!project.generated_image_url && traceState === 'idle' \? 'dimmed' : ''}\`}>/, '<div className={`node-card ${!project.generated_image_url && traceState === "idle" ? "dimmed" : ""}`} style={{ position: "absolute", left: 850, top: 570, zIndex: 10 }}>');

// 4. Dummy 2 (Color Match)
content = content.replace(/<div className={\`node-card intermediate-node \${!project.generated_image_url && traceState !== 'step2' \? 'dimmed' : ''}\`}>/, '<div className={`node-card intermediate-node ${!project.generated_image_url && traceState !== "step2" ? "dimmed" : ""}`} style={{ position: "absolute", left: 1250, top: 260, zIndex: 10 }}>');

// 5. ClawScale Main
content = content.replace(/<div className={\`node-card \${!project.upscaled_image_url && traceState !== 'step2' \? 'dimmed' : ''}\`}>/, '<div className={`node-card ${!project.upscaled_image_url && traceState !== "step2" ? "dimmed" : ""}`} style={{ position: "absolute", left: 1600, top: 570, zIndex: 10 }}>');


// 6. Dummy 3 (Bezier Smooth)
content = content.replace(/<div className={\`node-card intermediate-node \${!project.upscaled_image_url && traceState !== 'step3' \? 'dimmed' : ''}\`}>/, '<div className={`node-card intermediate-node ${!project.upscaled_image_url && traceState !== "step3" ? "dimmed" : ""}`} style={{ position: "absolute", left: 2000, top: 260, zIndex: 10 }}>');

// Add Dummy 3.5 (Path Optimizer) right after Dummy 3
const dummyPath = `
              {/* DUMMY NODE 3.5: Path Optimizer */}
              <div className={\`node-card intermediate-node \${!project.upscaled_image_url && traceState !== 'step3' ? 'dimmed' : ''}\`} style={{ position: "absolute", left: 2000, top: 960, zIndex: 10 }}>
                <div className="node-port input"></div>
                <div className="node-header">
                  <div className="node-header-title"><Layers size={12}/> Anchor Simplifier</div>
                </div>
                <div className="node-content checkerboard">
                  {project.upscaled_image_url ? (
                    <img src={\`/api/proxy?url=\${encodeURIComponent(project.upscaled_image_url)}\`} alt="Anchor" style={{width: '100%', height: '100%', objectFit: 'contain', filter: 'hue-rotate(90deg) contrast(150%)'}} referrerPolicy="no-referrer" decoding="async" />
                  ) : traceState === "step3" && project.upscaled_image_url ? (
                    <div className="node-loading-overlay">
                      <div className="node-spinner"></div>
                      <span>Simplifying...</span>
                    </div>
                  ) : (
                    <div className="placeholder-node">Awaiting Matrix</div>
                  )}
                </div>
                <div className="node-footer" style={{ padding: '8px 12px', borderTop: '1px solid #222', fontSize: '11px', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
                  <span>Pre-Vector AI</span>
                  <span style={{ color: traceState === 'step3' ? '#FFD700' : project.upscaled_image_url ? '#4ade80' : '#555' }}>
                    {traceState === 'step3' ? '▶ Processing...' : project.upscaled_image_url ? '✓ Optimized' : '○ Pending'}
                  </span>
                </div>
                <div className="node-port output"></div>
              </div>
`;
content = content.replace(/(Bezier Path Optimizer[\s\S]*?<\/div>\s*<\/div>\s*<\/div>)/, '$1' + dummyPath);

// 7. TrueVector Main
content = content.replace(/<div className={\`node-card \${!project.svg_url && traceState !== 'step3' \? 'dimmed' : ''}\`}>/, '<div className={`node-card ${!project.svg_url && traceState !== "step3" ? "dimmed" : ""}`} style={{ position: "absolute", left: 2350, top: 570, zIndex: 10 }}>');

fs.writeFileSync(filePath, content);
console.log('Update complete!');
