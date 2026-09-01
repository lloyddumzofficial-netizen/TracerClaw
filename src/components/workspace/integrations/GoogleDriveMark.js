"use client";

import Image from "next/image";

export default function GoogleDriveMark({ size = 18, className = "" }) {
  return (
    <Image
      src="/Google_Drive_Logo_05.2026.png"
      alt=""
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain" }}
    />
  );
}
