"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQ_DATA = [
  {
    q: "What is DesaynClaw?",
    a: "DesaynClaw is an AI-powered tool for sublimation jersey design extraction, vector auto-tracing, logo enhancement, background removal, and 4K image upscaling. It's built specifically for print shops and apparel designers who need clean, print-ready files fast."
  },
  {
    q: "How do I extract a flat sublimation design from a jersey mockup?",
    a: "Simply upload your jersey mockup image, choose 'Flat Extract' mode, and our AI will automatically remove the 3D shirt shape, correct the perspective, and output a clean flat rectangular sublimation print file ready for production."
  },
  {
    q: "Can DesaynClaw convert my logo to SVG vector?",
    a: "Yes! DesaynClaw can auto-trace your PNG or JPG logo into a clean, scalable SVG vector file. It removes compression artifacts, enhances the design, and outputs a production-ready SVG you can open in Adobe Illustrator, CorelDRAW, or Inkscape."
  },
  {
    q: "Does DesaynClaw support background removal?",
    a: "Yes. DesaynClaw has a built-in AI background remover that can cleanly cut out jersey designs, logos, and product photos to produce transparent PNG files — no Photoshop required."
  },
  {
    q: "Can I upscale a low-resolution sublimation design?",
    a: "Absolutely. DesaynClaw's AI upscaler can enhance any low-resolution sublimation design, jersey artwork, or logo to 4K quality — making it suitable for large format printing without quality loss."
  },
  {
    q: "Is DesaynClaw free to use?",
    a: "No, DesaynClaw is a paid premium tool. We do not offer a free tier. However, our pricing is designed to be highly affordable for print shops and solo designers, giving you incredible value for the time you save."
  }
];

export default function FAQSection() {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section style={{
      maxWidth: "800px",
      margin: "120px auto 60px",
      padding: "0 20px"
    }}>
      <div style={{ textAlign: "center", marginBottom: "50px" }}>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          color: "#FFD700",
          fontSize: "11px",
          fontWeight: "800",
          letterSpacing: "2.5px",
          textTransform: "uppercase",
          padding: "6px 16px",
          border: "1px solid rgba(255, 215, 0, 0.2)",
          background: "rgba(255, 215, 0, 0.05)",
          borderRadius: "100px",
          marginBottom: "20px"
        }}>
          Got Questions?
        </div>
        <h2 style={{
          fontSize: "36px",
          fontWeight: "850",
          color: "#fff",
          letterSpacing: "-0.5px",
          margin: "0 0 16px"
        }}>
          Frequently Asked Questions
        </h2>
        <p style={{ color: "#888", fontSize: "15px", maxWidth: "500px", margin: "0 auto", lineHeight: "1.6" }}>
          Everything you need to know about DesaynClaw and how it streamlines your print shop workflow.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {FAQ_DATA.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div 
              key={idx} 
              onClick={() => setOpenIndex(isOpen ? -1 : idx)}
              style={{
                background: isOpen ? "rgba(255,255,255,0.03)" : "rgba(20,20,20,0.4)",
                border: "1px solid",
                borderColor: isOpen ? "rgba(255, 215, 0, 0.3)" : "rgba(255,255,255,0.05)",
                borderRadius: "12px",
                padding: "24px",
                cursor: "pointer",
                transition: "all 0.3s ease",
                position: "relative",
                overflow: "hidden"
              }}
              onMouseEnter={(e) => {
                if (!isOpen) e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
              }}
              onMouseLeave={(e) => {
                if (!isOpen) e.currentTarget.style.borderColor = "rgba(255,255,255,0.05)";
              }}
            >
              {/* Left Accent Bar */}
              {isOpen && (
                <div style={{
                  position: "absolute",
                  left: 0,
                  top: "24px",
                  bottom: "24px",
                  width: "3px",
                  background: "#FFD700",
                  borderRadius: "0 4px 4px 0",
                  boxShadow: "0 0 12px rgba(255,215,0,0.5)"
                }} />
              )}
              
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "20px" }}>
                <h3 style={{ 
                  margin: 0, 
                  fontSize: "16px", 
                  fontWeight: isOpen ? "700" : "500", 
                  color: isOpen ? "#fff" : "#ccc",
                  lineHeight: "1.4",
                  paddingLeft: isOpen ? "8px" : "0",
                  transition: "padding 0.3s ease, color 0.3s ease"
                }}>
                  {faq.q}
                </h3>
                <ChevronDown 
                  size={20} 
                  color={isOpen ? "#FFD700" : "#666"} 
                  style={{ 
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)", 
                    transition: "transform 0.3s ease, color 0.3s ease",
                    flexShrink: 0
                  }} 
                />
              </div>
              
              <div style={{
                maxHeight: isOpen ? "200px" : "0",
                opacity: isOpen ? 1 : 0,
                overflow: "hidden",
                transition: "all 0.3s ease-in-out",
                marginTop: isOpen ? "16px" : "0",
                color: "#888",
                fontSize: "14px",
                lineHeight: "1.7",
                paddingLeft: isOpen ? "8px" : "0",
              }}>
                {faq.a}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
