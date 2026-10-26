"use client";

import ImageToolPropertiesPanel from "@/components/image-tools/ImageToolPropertiesPanel";
import { UPSCALE_TOOL } from "@/components/image-tools/toolPresets";
import { UPSCALE_PROFILES } from "@/lib/standaloneUpscale";
import styles from "@/components/image-tools/image-tool.module.css";

export default function UpscalePropertiesPanel({ profile, onProfileChange, ...props }) {
  return <ImageToolPropertiesPanel {...props} tool={UPSCALE_TOOL} modeControl={
    <>
      <select className={styles.profileSelect} aria-label="Image type" value={profile} onChange={event => onProfileChange(event.target.value)} disabled={props.isProcessing || Boolean(props.resultUrl)}>
        {Object.entries(UPSCALE_PROFILES).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}
      </select>
      <small>Precision 4× · Face recovery off</small>
    </>
  } />;
}
