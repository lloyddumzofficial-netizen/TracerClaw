"use client";

import { memo } from "react";

const TraceIcon = memo(function TraceIcon({ size = 16, color = "#FFD700" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Outer Coin Circle */}
      <circle cx="10" cy="12" r="8" stroke={color} strokeWidth="2" />
      <circle cx="10" cy="12" r="9" stroke={color} strokeWidth="0.5" opacity="0.5" />
      {/* Inner Shirt */}
      <path d="M7 8H13L14 10H13V15H7V10H6L7 8Z" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Dotted Trail */}
      <circle cx="18" cy="8" r="1" fill={color} />
      <circle cx="21" cy="6" r="1.5" fill={color} />
      <circle cx="20" cy="10" r="1" fill={color} />
    </svg>
  );
});

export default TraceIcon;
