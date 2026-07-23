"use client";

import { memo } from "react";

const EduSection = memo(function EduSection() {
  return (
    <>
      {/* HOW TO USE / DEMO VIDEO SECTION */}
      <div className="demo-section" style={{ marginTop: "60px", width: "100%", display: "flex", flexWrap: "wrap", gap: "60px", alignItems: "center", background: "transparent", padding: "0" }}>
        
        {/* Video Left */}
        <div style={{ flex: "1 1 min(100%, 400px)" }}>
          <video 
            src="/demo.mp4" 
            autoPlay 
            muted 
            loop 
            playsInline 
            style={{ width: "100%", borderRadius: "8px", border: "1px solid #333" }} 
          />
        </div>

        {/* Text Details Right */}
        <div style={{ flex: "1 1 min(100%, 400px)", textAlign: "left", display: "flex", flexDirection: "column", gap: "20px" }}>
          <h3 style={{ color: "#FFD700", fontSize: "14px", textTransform: "uppercase", letterSpacing: "1.5px", margin: 0, fontWeight: "bold" }}>How to Use DesaynClaw</h3>
          <h2 style={{ color: "#fff", fontSize: "36px", margin: 0, fontWeight: "600", letterSpacing: "-1px", lineHeight: "1.2" }}>Convert images in seconds.</h2>
          <p style={{ color: "#aaa", fontSize: "16px", lineHeight: "1.6", margin: 0 }}>
            Our advanced AI handles the complex tracing process for you. No manual pen tool required.
          </p>
          
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "15px" }}>
            <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ background: "#333", color: "#FFD700", width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold", flexShrink: 0 }}>1</div>
              <div style={{ color: "#d5d5d5", fontSize: "14px", lineHeight: "1.5" }}>Upload any PNG or JPEG logo, sketch, or photo.</div>
            </li>
            <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ background: "#333", color: "#FFD700", width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold", flexShrink: 0 }}>2</div>
              <div style={{ color: "#d5d5d5", fontSize: "14px", lineHeight: "1.5" }}>Our neural engine cleans noise and traces perfect vector paths.</div>
            </li>
            <li style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
              <div style={{ background: "#333", color: "#FFD700", width: "24px", height: "24px", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "bold", flexShrink: 0 }}>3</div>
              <div style={{ color: "#d5d5d5", fontSize: "14px", lineHeight: "1.5" }}>Download your crisp, infinitely scalable SVG instantly.</div>
            </li>
          </ul>
        </div>

      </div>

      {/* EDUCATIONAL SECTION */}
      <div className="edu-section" style={{ marginTop: "80px", width: "100%", borderTop: "1px solid #222", paddingTop: "60px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px", textAlign: "left" }}>
          
          {/* Col 1 */}
          <div style={{ background: "#111", border: "1px solid #333", padding: "32px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "20px", color: "#FFD700", marginBottom: "16px", fontWeight: "bold" }}>How does it work</h3>
            <p style={{ color: "#aaa", fontSize: "14px", lineHeight: "1.6", flex: 1 }}>
              Vectorization of raster images is done by converting pixel color information into simple geometric objects. The most common variant is looking over edge detection areas of the same or similar brightness or color, which are then expressed as graphic primitives like lines, circles, and curves.
            </p>
          </div>

          {/* Col 2 */}
          <div style={{ background: "#111", border: "1px solid #333", padding: "32px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "20px", color: "#fff", marginBottom: "16px", fontWeight: "bold" }}>Raster Graphics</h3>
            <p style={{ color: "#aaa", fontSize: "14px", lineHeight: "1.6", flex: 1 }}>
              A Raster graphics image is a rectangular grid of pixels, in which each pixel (or point) has an associated color value. Changing the size of the raster image mostly results in loss of apparent quality.
              <br/><br/>
              <i style={{ color: "#888" }}>examples: photos</i>
            </p>
          </div>

          {/* Col 3 */}
          <div style={{ background: "#111", border: "1px solid #333", padding: "32px", display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "20px", color: "#fff", marginBottom: "16px", fontWeight: "bold" }}>Vector Graphics</h3>
            <p style={{ color: "#aaa", fontSize: "14px", lineHeight: "1.6", flex: 1 }}>
              Vector graphics are not based on pixels but on primitives such as points, lines, curves which are represented by mathematical expressions. Without a loss in quality, vector graphics are easily scalable and rotatable.
              <br/><br/>
              <i style={{ color: "#888" }}>examples: cliparts, logos, tattoos, decals, stickers, t-shirt designs</i>
            </p>
          </div>

        </div>
      </div>
    </>
  );
});

export default EduSection;
