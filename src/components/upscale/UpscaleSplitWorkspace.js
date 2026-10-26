"use client";

import ImageToolSplitWorkspace from "@/components/image-tools/ImageToolSplitWorkspace";
import { UPSCALE_TOOL } from "@/components/image-tools/toolPresets";

export default function UpscaleSplitWorkspace(props) {
  return <ImageToolSplitWorkspace {...props} tool={UPSCALE_TOOL} />;
}
