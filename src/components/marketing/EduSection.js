"use client";

import { memo } from "react";

const EduSection = memo(function EduSection() {
  const workflowSteps = [
    {
      title: "Upload the real source file",
      copy: "Start with a logo, jersey mockup, sketch, product photo, or client artwork that needs cleanup.",
    },
    {
      title: "Pick the production tool",
      copy: "Crop the printable area, trace to SVG, upscale rough images, or remove the background in one focused flow.",
    },
    {
      title: "Export files ready to send",
      copy: "Download editable SVG, high-res PNG, transparent assets, or a ZIP package for print handoff.",
    },
  ];

  return (
    <>
      {/* HOW TO USE / DEMO VIDEO SECTION */}
      <div className="edu-demo-section">
        <div className="edu-demo-video">
          <video
            src="https://pub-f2ce547db5ec43259557b815b0c02ae8.r2.dev/VIDEO-SHOWREEL.mp4"
            autoPlay
            muted
            loop
            playsInline
            className="edu-demo-video-el"
          />
          <div className="edu-demo-video-caption">
            <span>Live workspace preview</span>
            <strong>Crop, trace, upscale, export</strong>
          </div>
        </div>

        <div className="edu-demo-text">
          <p className="edu-demo-eyebrow">Production Workflow</p>
          <h2 className="edu-demo-heading">From upload to editable output.</h2>
          <p className="edu-demo-body">
            DesaynClaw keeps messy artwork moving through one clean handoff: isolate the artwork,
            run the right AI tool, then export files your production workflow can actually use.
          </p>

          <ol className="edu-demo-steps">
            {workflowSteps.map((step, i) => (
              <li key={i} className="edu-demo-step">
                <span className="edu-step-num">{i + 1}</span>
                <span className="edu-step-content">
                  <strong>{step.title}</strong>
                  <span>{step.copy}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* EDUCATIONAL SECTION */}
      <div className="edu-cards-section">
        <div className="edu-cards-grid">

          {/* Col 1 — accent */}
          <div className="edu-card edu-card--accent">
            <h3 className="edu-card-title">How does it work</h3>
            <p className="edu-card-body">
              Vectorization of raster images is done by converting pixel color information into simple geometric objects. The most common variant is looking over edge detection areas of the same or similar brightness or color, which are then expressed as graphic primitives like lines, circles, and curves.
            </p>
          </div>

          {/* Col 2 */}
          <div className="edu-card">
            <h3 className="edu-card-title">Raster Graphics</h3>
            <p className="edu-card-body">
              A Raster graphics image is a rectangular grid of pixels, in which each pixel (or point) has an associated color value. Changing the size of the raster image mostly results in loss of apparent quality.
            </p>
            <p className="edu-card-examples">examples: photos</p>
          </div>

          {/* Col 3 */}
          <div className="edu-card">
            <h3 className="edu-card-title">Vector Graphics</h3>
            <p className="edu-card-body">
              Vector graphics are not based on pixels but on primitives such as points, lines, curves which are represented by mathematical expressions. Without a loss in quality, vector graphics are easily scalable and rotatable.
            </p>
            <p className="edu-card-examples">examples: cliparts, logos, tattoos, decals, stickers, t-shirt designs</p>
          </div>

        </div>
      </div>
    </>
  );
});

export default EduSection;
