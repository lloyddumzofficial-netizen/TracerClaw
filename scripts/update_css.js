const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src/app/globals.css');
let css = fs.readFileSync(cssPath, 'utf8');

// Update .node-card to be exactly uniform and elegant
css = css.replace(/\.node-card\s*\{[^}]+\}/, `.node-card {
  width: 320px; 
  height: 400px;
  display: flex;
  flex-direction: column;
  background-color: #0f0f11;
  border: 1px solid #27272a;
  border-radius: 12px;
  box-shadow: 0 10px 40px -10px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.05);
  position: relative;
  padding: 12px;
  z-index: 10;
  transition: opacity 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease;
}`);

// Update node-content to center everything perfectly
css = css.replace(/\.node-content\s*\{[^}]+\}/, `.node-content {
  background-color: #09090b;
  border: 1px solid #1f1f22;
  border-radius: 8px;
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  margin: 12px 0;
  position: relative;
}`);

// Add a glowing elegant connector style
css += `
.elegant-connector {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 80px;
  height: 100%;
}
.elegant-arrow {
  width: 100%;
  height: 2px;
  background: #333;
  position: relative;
  transition: all 0.5s ease;
}
.elegant-arrow::after {
  content: '';
  position: absolute;
  right: -5px;
  top: -4px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 6px solid #333;
  transition: all 0.5s ease;
}
.elegant-connector.active .elegant-arrow {
  background: linear-gradient(90deg, #333 0%, #FFD700 100%);
  box-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  animation: pulseArrow 1.5s infinite alternate;
}
.elegant-connector.active .elegant-arrow::after {
  border-left-color: #FFD700;
}
.elegant-connector.completed .elegant-arrow {
  background: #4ade80;
}
.elegant-connector.completed .elegant-arrow::after {
  border-left-color: #4ade80;
}
@keyframes pulseArrow {
  0% { opacity: 0.5; box-shadow: 0 0 5px rgba(255, 215, 0, 0.2); }
  100% { opacity: 1; box-shadow: 0 0 15px rgba(255, 215, 0, 0.8); }
}
`;

fs.writeFileSync(cssPath, css);
console.log('CSS updated successfully');
