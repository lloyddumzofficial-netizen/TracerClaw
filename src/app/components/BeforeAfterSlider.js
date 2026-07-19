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

export default function BeforeAfterSlider({ 
  title, 
  rasterUrl, 
  vectorUrl, 
  height = '400px',
  aspectRatio = null,
  objectFit = 'cover',
  objectPosition = 'center',
  layout = 'vertical',
  leftLabel = "Vectorized SVG",
  rightLabel = "Original Photo",
  description = "Slide to compare the original photo vs. the extracted vector SVG.",
  showCheckerboard = false,
  pixelateRaster = false
}) {
  const [sliderPosition, setSliderPosition] = useState(50);

  const isHorizontal = layout === 'horizontal' || layout === 'horizontal-reverse';
  const flexDirection = layout === 'horizontal-reverse' ? 'row-reverse' : (layout === 'horizontal' ? 'row' : 'column');

  return (
    <div style={{ textAlign: 'left', height: '100%', width: '100%' }}>
      
      <div style={{ 
        width: '100%',
        height: '100%',
        background: '#1a1a1a', 
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '8px',
        display: 'flex', 
        flexDirection: flexDirection, 
        gap: '16px',
        borderRadius: '0',
        alignItems: isHorizontal ? 'center' : 'stretch',
        boxSizing: 'border-box'
      }}>
        <div style={{ 
          position: 'relative', 
          height: aspectRatio ? 'auto' : height, 
          aspectRatio: aspectRatio || 'auto',
          flex: isHorizontal ? '1' : 'none',
          minWidth: isHorizontal ? '60%' : 'auto',
          background: '#000', 
          overflow: 'hidden', 
          border: '1px solid rgba(255,255,255,0.08)', 
          borderRadius: '0' 
        }}>
          
          {/* Original Image (Background / Right Side) */}
          <img 
            src={rasterUrl} 
            alt="Original Photo" 
            style={{ 
              position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: objectFit,
              objectPosition: objectPosition,
              imageRendering: pixelateRaster ? 'pixelated' : 'auto'
            }} 
          />
          <span style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: '11px', color: '#fff', borderRadius: '0', zIndex: 1 }}>{rightLabel}</span>
          
          {/* Vectorized SVG (Foreground / Left Side) with clip path container */}
          <div style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2,
            clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`
          }}>
            {showCheckerboard && (
              <div style={{ 
                position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 
                background: 'repeating-conic-gradient(#2a2a2a 0% 25%, #1a1a1a 0% 50%) 50% / 20px 20px' 
              }}></div>
            )}
            <InlineSVG 
              url={vectorUrl} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: objectFit, objectPosition: objectPosition }} 
            />
          </div>
          <span style={{ position: 'absolute', top: 12, left: 12, background: '#FFD700', padding: '4px 10px', fontSize: '11px', color: '#000', fontWeight: 'bold', borderRadius: '0', zIndex: 3, opacity: sliderPosition > 10 ? 1 : 0, transition: 'opacity 0.2s' }}>{leftLabel}</span>

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
        
        {(title || description) && (
          <div style={{ flex: isHorizontal ? '1' : 'none', padding: isHorizontal ? '0 16px' : '0' }}>
            {title && <div style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold' }}>{title}</div>}
            {description && <div style={{ fontSize: '13px', color: '#888', marginTop: '4px', lineHeight: '1.5' }}>{description}</div>}
          </div>
        )}

      </div>
    </div>
  );
}
