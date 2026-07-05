const fs = require('fs');
fs.appendFileSync('src/app/globals.css', `
.node-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 12px; font-size: 10px; color: #71717a; }
.re-run-btn { background: #27272a; color: #a1a1aa; border: none; padding: 6px 10px; border-radius: 6px; font-size: 10px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: 0.2s; font-weight: 500; }
.re-run-btn:hover { background: #3f3f46; color: #fff; }
`);
