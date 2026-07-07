"use client";

import { useState } from 'react';

export default function BeforeAfterSlider({ title, rasterUrl, vectorUrl }) {
  const [sliderPosition, setSliderPosition] = useState(50);

  return (
    <div style={{ textAlign: 'center' }}>
      
      <div style={{ 
        width: '100%',
        background: '#1a1a1a', 
        border: '1px solid #333', 
        padding: '16px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        borderRadius: '12px',
        textAlign: 'left'
      }}>
        <div style={{ position: 'relative', height: '400px', background: '#000', overflow: 'hidden', border: '1px solid #444', borderRadius: '8px' }}>
          
          {/* Original Image (Background / Right Side) */}
          <img 
            src={rasterUrl} 
            alt="Original Photo" 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover' }} 
          />
          <span style={{ position: 'absolute', top: 12, right: 12, background: 'rgba(0,0,0,0.7)', padding: '4px 10px', fontSize: '11px', color: '#fff', borderRadius: '4px', zIndex: 1 }}>Original Photo</span>
          
          {/* Vectorized SVG (Foreground / Left Side) */}
          <img 
            src={vectorUrl} 
            alt="Vectorized SVG" 
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`, zIndex: 2 }} 
          />
          <span style={{ position: 'absolute', top: 12, left: 12, background: '#FFD700', padding: '4px 10px', fontSize: '11px', color: '#000', fontWeight: 'bold', borderRadius: '4px', zIndex: 3, opacity: sliderPosition > 10 ? 1 : 0, transition: 'opacity 0.2s' }}>Vectorized SVG</span>

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
