"use client";

import { useState } from 'react';
import SafeInlineSVG from "@/components/shared/SafeInlineSVG";

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
    <div className="ba-slider-shell">
      <div
        className={`ba-slider-card ${isHorizontal ? "is-horizontal" : ""}`}
        style={{
          flexDirection,
          alignItems: isHorizontal ? 'center' : 'stretch',
        }}
      >
        <div
          className="ba-slider-stage"
          style={{
            height: aspectRatio ? 'auto' : height,
            aspectRatio: aspectRatio || 'auto',
            flex: isHorizontal ? '1' : 'none',
            minWidth: isHorizontal ? '60%' : 'auto',
          }}
        >
          
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
          <span className="ba-slider-label ba-slider-label-right">{rightLabel}</span>
          
          {/* Vectorized SVG (Foreground / Left Side) with clip path container */}
          <div style={{ 
            position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2,
            clipPath: `polygon(0 0, ${sliderPosition}% 0, ${sliderPosition}% 100%, 0 100%)`
          }}>
            {showCheckerboard && (
              <div className="ba-slider-checkerboard"></div>
            )}
            <SafeInlineSVG
              url={vectorUrl} 
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: objectFit, objectPosition: objectPosition }} 
              fallbackToImage
            />
          </div>
          <span className="ba-slider-label ba-slider-label-left" style={{ opacity: sliderPosition > 10 ? 1 : 0 }}>{leftLabel}</span>

          {/* Slider Divider Line */}
          <div className="ba-slider-divider" style={{ left: `${sliderPosition}%` }}></div>
          
          {/* Slider Handle Visual */}
          <div className="ba-slider-handle" style={{ left: `${sliderPosition}%` }}>
            <div>
              <span></span>
              <span></span>
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
          <div className="ba-slider-copy" style={{ flex: isHorizontal ? '1' : 'none', padding: isHorizontal ? '0 16px' : '0' }}>
            {title && <div className="ba-slider-title">{title}</div>}
            {description && <div className="ba-slider-description">{description}</div>}
          </div>
        )}

      </div>
    </div>
  );
}
