"use client";

import { useEffect, useState } from "react";

export default function useImageMetadata(url) {
  const [metadata, setMetadata] = useState(null);
  useEffect(() => {
    setMetadata(null);
    if (!url) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      if (!active || !image.naturalWidth || !image.naturalHeight) return;
      const format = String(url).match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toUpperCase().replace("JPEG", "JPG") || "Image";
      setMetadata({ width: image.naturalWidth, height: image.naturalHeight, format, fileSize: "Cloud source" });
    };
    image.src = url;
    return () => { active = false; image.onload = null; };
  }, [url]);
  return metadata;
}
