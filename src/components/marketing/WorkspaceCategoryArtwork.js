"use client";

import { useId } from "react";

const SHIRT = "M70 44 53 51 39 74 55 85 65 73V126H127V73L137 85 153 74 139 51 122 44C116 57 106 61 96 61S76 57 70 44Z";

function GarmentArtwork() {
  return (
    <>
      <path d="M52 28H30V50M140 28H162V50M30 122V144H52M162 122V144H140" strokeWidth="2.5" />
      <path d={SHIRT} fill="currentColor" fillOpacity=".9" stroke="none" />
      <path d="M96 62V126H127V73L137 85 153 74 139 51 122 44C116 57 106 61 96 61Z" fill="#08090A" fillOpacity=".17" stroke="none" />
      <path d="M96 28V146" stroke="#08090A" strokeWidth="1.5" strokeDasharray="4 5" />
      <path d="M96 28V42M96 132V146" strokeOpacity=".6" strokeDasharray="3 4" />
      <path d="M76 47C81 66 111 66 116 47M65 114H127" stroke="#08090A" strokeOpacity=".22" />
    </>
  );
}

function VectorArtwork() {
  return (
    <>
      <rect x="34" y="25" width="124" height="124" rx="2" strokeOpacity=".58" />
      <path d="M58 111 74 62 111 50 135 75 119 123 87 133Z" fill="currentColor" fillOpacity=".08" stroke="none" />
      <path d="M61 119 81 64 127 48 139 60 123 106 68 126Z" fill="currentColor" fillOpacity=".92" stroke="none" />
      <path d="M68 120 104 84M84 65 123 104" stroke="#08090A" strokeWidth="1.6" />
      <circle cx="108" cy="80" r="6" fill="#08090A" stroke="none" />
      <path d="M56 112C56 76 78 56 116 56" strokeOpacity=".45" strokeDasharray="2 5" />
      {[ [34, 25], [96, 25], [158, 25], [34, 87], [158, 87], [34, 149], [96, 149], [158, 149] ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 4} y={y - 4} width="8" height="8" rx="1.5" fill="currentColor" stroke="none" />
      ))}
    </>
  );
}

function PatternArtwork() {
  return (
    <>
      <rect x="28" y="20" width="136" height="136" rx="15" strokeOpacity=".65" />
      <path d="M96 20V156M28 88H164" strokeOpacity=".25" />
      <g fill="currentColor" stroke="none">
        {[0, 90, 180, 270].map(angle => <path key={angle} d="M62 54C43 55 42 37 43 34 60 33 64 42 62 54Z" transform={`rotate(${angle} 62 54)`} fillOpacity={angle === 90 ? ".58" : ".9"} />)}
        <path d="M130 32C130 46 137 53 151 54 137 55 130 63 130 77 129 63 122 55 108 54 122 53 129 46 130 32Z" fillOpacity=".9" />
        <path d="M40 104C66 99 82 112 85 140 68 143 54 134 53 118 55 132 46 135 40 135 45 124 47 114 40 104Z" fillOpacity=".9" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => <ellipse key={angle} cx="130" cy="107" rx="5" ry="10" transform={`rotate(${angle} 130 124)`} fillOpacity={angle % 90 ? ".58" : ".9"} />)}
        <circle cx="130" cy="124" r="5" fillOpacity=".9" />
      </g>
    </>
  );
}

function CutoutArtwork({ id }) {
  return (
    <>
      <defs>
        <pattern id={`${id}-checker`} width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="currentColor" fillOpacity=".07" />
          <path d="M0 0H6V6H0ZM6 6H12V12H6Z" fill="currentColor" fillOpacity=".2" />
        </pattern>
        <clipPath id={`${id}-half`}><rect x="32" y="32" width="64" height="100" /></clipPath>
      </defs>
      <rect x="29" y="22" width="134" height="128" rx="18" strokeOpacity=".3" />
      <path d={SHIRT} fill={`url(#${id}-checker)`} strokeOpacity=".55" />
      <path d={SHIRT} fill="currentColor" fillOpacity=".92" stroke="none" clipPath={`url(#${id}-half)`} />
      <path d="M96 28V134" strokeDasharray="4 5" strokeOpacity=".85" />
      <circle cx="49" cy="131" r="22" fill="#08090A" strokeOpacity=".6" />
      <g transform="translate(33 115)" strokeWidth="2">
        <circle cx="7" cy="9" r="4" /><circle cx="7" cy="23" r="4" />
        <path d="M10 12 25 26M10 20 25 6" />
      </g>
    </>
  );
}

function MockupArtwork() {
  return (
    <>
      <rect x="27" y="27" width="94" height="111" rx="8" strokeOpacity=".8" />
      <path d="M27 45H121M35 139H113" strokeOpacity=".3" />
      <circle cx="35" cy="36" r="1.5" fill="currentColor" stroke="none" /><circle cx="42" cy="36" r="1.5" fill="currentColor" stroke="none" />
      <svg x="35" y="42" width="78" height="90" viewBox="32 30 128 114">
        <path d={SHIRT} fill="currentColor" fillOpacity=".9" stroke="none" />
        <path d="M76 47C81 66 111 66 116 47" stroke="#08090A" strokeOpacity=".3" />
      </svg>
      <path d="M63 139V147H85V139M52 150H96" strokeOpacity=".6" />
      {[ [136, 27], [136, 70], [136, 113] ].map(([x, y], index) => (
        <g key={y} opacity={index === 0 ? 1 : .45}>
          <rect x={x - 5} y={y - 1} width="34" height="36" rx="5" strokeOpacity=".55" />
          <path d={`M${x + 4} ${y + 7} ${x - 1} ${y + 10} ${x - 3} ${y + 17} ${x + 2} ${y + 19} ${x + 4} ${y + 15}V${y + 27}H${x + 20}V${y + 15}L${x + 22} ${y + 19} ${x + 27} ${y + 17} ${x + 25} ${y + 10} ${x + 20} ${y + 7}C${x + 17} ${y + 13} ${x + 7} ${y + 13} ${x + 4} ${y + 7}Z`} fill="currentColor" fillOpacity=".7" stroke="none" />
        </g>
      ))}
    </>
  );
}

export default function WorkspaceCategoryArtwork({ variant }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 192 176" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-workspace-artwork={variant}>
      {variant === "garment" && <GarmentArtwork />}
      {variant === "logo" && <VectorArtwork />}
      {variant === "pattern" && <PatternArtwork />}
      {variant === "bg_remover" && <CutoutArtwork id={id} />}
      {variant === "mockup_studio" && <MockupArtwork />}
    </svg>
  );
}
