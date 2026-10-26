"use client";

import ImageToolEntryScreen from "@/components/image-tools/ImageToolEntryScreen";
import { UPSCALE_TOOL } from "@/components/image-tools/toolPresets";

export default function UpscaleEntryScreen(props) {
  return <ImageToolEntryScreen {...props} tool={UPSCALE_TOOL} />;
}
