"use client";

import { useState } from "react";
import { GARMENT_SAMPLES } from "@/lib/garmentSamples";
import BeforeAfterSlider from "./BeforeAfterSlider";
import styles from "./GarmentSamplePreview.module.css";

export default function GarmentSamplePreview() {
  const [sampleId, setSampleId] = useState("tabako");
  const sample = GARMENT_SAMPLES.find(item => item.id === sampleId);

  return (
    <div className={styles.preview}>
      <div className={styles.choices} role="group" aria-label="Choose garment sample">
        {GARMENT_SAMPLES.map(item => (
          <button key={item.id} type="button" aria-pressed={item.id === sampleId} onClick={() => setSampleId(item.id)}>
            {item.title}
          </button>
        ))}
      </div>
      <BeforeAfterSlider
        key={sample.id}
        rasterUrl={sample.originalUrl}
        vectorUrl={sample.extractedUrl}
        rasterAlt={sample.originalAlt}
        vectorAlt={sample.extractedAlt}
        aspectRatio="1 / 1"
        objectFit="contain"
        leftLabel="Extracted artwork"
        rightLabel="Original mockup"
        description=""
      />
    </div>
  );
}
