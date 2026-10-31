"use client";

import { memo, useCallback, useEffect, useState } from "react";
import ReactCrop from "react-image-crop";

// Pointer moves update only the selection and image subtree. The modal toolbar,
// guide videos, and actions receive the final percentage crop on completion.
const CropSelectionCanvas = memo(function CropSelectionCanvas({
  imageRef,
  sourceUrl,
  displayWidth,
  displayHeight,
  imageReady,
  resetVersion,
  onImageLoad,
  onCropStart,
  onCropComplete,
}) {
  const [crop, setCrop] = useState();

  useEffect(() => {
    setCrop(undefined);
  }, [resetVersion]);

  const handleChange = useCallback((pixelCrop, percentCrop) => {
    setCrop(percentCrop);
  }, []);

  return (
    <ReactCrop
      crop={crop}
      onChange={handleChange}
      onComplete={onCropComplete}
      onDragStart={onCropStart}
      ruleOfThirds
      className="designer-crop"
      style={{ width: displayWidth ? `${displayWidth}px` : "auto" }}
    >
      <img
        ref={imageRef}
        src={sourceUrl}
        alt="Crop source"
        className="crop-source-image"
        width={displayWidth || 1}
        height={displayHeight || 1}
        style={{
          width: displayWidth ? `${displayWidth}px` : "1px",
          height: displayHeight ? `${displayHeight}px` : "1px",
          opacity: imageReady ? 1 : 0,
        }}
        crossOrigin="anonymous"
        onLoad={onImageLoad}
      />
    </ReactCrop>
  );
});

export default CropSelectionCanvas;
