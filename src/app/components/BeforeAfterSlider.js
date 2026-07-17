"use client";

import { useState, useEffect } from 'react';

/** Fetches SVG text and injects inline for reliable cross-browser SVG rendering */
function InlineSVG({ url, style }) {
  const [svgHtml, setSvgHtml] = useState(null);
  const [isSvg, setIsSvg] = useState(true);

  useEffect(() => {
    if (!url) { setSvgHtml(null); return; }
    
    // If it's explicitly not an SVG (e.g. png fallback), fallback to img tag immediately
    if (!url.toLowerCase().endsWith('.svg') && !url.includes('svg')) {
      setIsSvg(false);
      return;
    }

    setSvgHtml(null);
    setIsSvg(true);
    fetch(url)
      .then(r => r.text())
      .then(text => {
        const safe = text
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/\son\w+="[^"]*"/gi, '')
          .replace(/\son\w+='[^']*'/gi, '');
        if (safe.includes('<svg')) {
          const scaled = safe.replace(/<svg([^>]*?)>/i, (_, attrs) => {
            let clean = attrs;
            const wMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
            const hMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
            const vMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);

            clean = clean.replace(/\s+width=["'][^"']*["']/gi, '')
                         .replace(/\s+height=["'][^"']*["']/gi, '')
                         .replace(/\s+preserveAspectRatio=["'][^"']*["']/gi, '')
                         .replace(/\s+style=["'][^"']*["']/gi, '');

            if (!vMatch && wMatch && hMatch) {
              const w = parseFloat(wMatch[1].replace(/px/i, ''));
              const h = parseFloat(hMatch[1].replace(/px/i, ''));
              if (!isNaN(w) && !isNaN(h)) {
                clean += ` viewBox="0 0 ${w} ${h}"`;
              }
            }
            return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
          });
          setSvgHtml(scaled);
        } else {
          // If fetch succeeds but it's not SVG text, fallback
          setIsSvg(false);
        }
      })
      .catch(err => {
        console.error('[InlineSVG] fetch failed:', err);
        setIsSvg(false);
      });
  }, [url]);

  if (!isSvg) {
    return <img src={url} alt="" style={style} />;
  }

  if (!svgHtml) return null;
  return <div style={{ ...style, overflow: 'hidden' }} dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}

export default function BeforeAfterSlider({ title, rasterUrl, vectorUrl, height = '400px' }) {
  const [sliderPosition, setSliderPosition] = useState(50);

  return (
    <div style={{ textAlign: 'center', height: '100%' }}>
      
      <div style={{ 
        width: '100%',
        height: '100%',
        background: '#1a1a1a', 
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '8px',
        display: 'flex', 
        flexDirection: 'column', 
        gap: '8px',
        borderRadius: '0',
        textAlign: 'left'
      }}>
        <div style={{ position: 'relative', height, background: '#000', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '0' }}>
          
          {/* Original Image (Background / Right Side) */}
          <img 
            src={rasterUrl} 
            alt="Original Photo" 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
          />
          <span style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: '11px', color: '#fff', borderRadius: '0', zIndex: 1 }}>Original Photo</span>
          
          {/* Vectorized SVG (Foreground / Left Side) */}
          <InlineSVG 
            url={vectorUrl} 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`, zIndex: 2 }} 
          />
          <span style={{ position: 'absolute', top: 12, left: 12, background: '#FFD700', padding: '4px 10px', fontSize: '11px', color: '#000', fontWeight: 'bold', borderRadius: '0', zIndex: 3, opacity: sliderPosition > 10 ? 1 : 0, transition: 'opacity 0.2s' }}>Vectorized SVG</span>

          {/* Slider Divider Line */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${sliderPosition}%`, width: '2px', background: '#FFD700', transform: 'translateX(-50%)', zIndex: 3, pointerEvents: 'none' }}></div>
          
          {/* Slider Handle Visual */}
          <div style={{ position: 'absolute', top: '50%', left: `${sliderPosition}%`, transform: 'translate(-50%, -50%)', width: '32px', height: '32px', background: '#FFD700', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3, pointerEvents: 'none', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', gap: '2px' }}>
              <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
              <div style={{ width: '2px', height: '12px', background: '#000' }}></div>
            </div>
          </div>

          {/* Invisible Range Input for Interaction */}
          <input 
            type="range" 
            min="0" max="100" 
            value={sliderPosition} 
            onChange={e => setSliderPosition(e.target.value)} 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'ew-resize', zIndex: 4, margin: 0 }} 
          />
          
        </div>
        
        <div>
          <div style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold' }}>{title}</div>
          <div style={{ fontSize: '13px', color: '#888', marginTop: '4px' }}>Slide to compare the original photo vs. the extracted vector SVG.</div>
        </div>

      </div>
    </div>
  );
}
