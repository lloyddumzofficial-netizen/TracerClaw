"use client";

import { useId } from "react";

const JERSEY = "M26 8 13 13 3 38 17 46 25 31 23 105Q50 113 77 105L75 31 83 46 97 38 87 13 74 8 62 4C58 16 42 16 38 4Z";
const VECTOR_MARK = "M65 46H91C117 46 134 62 134 86S117 127 91 127H65ZM84 64V109H91C107 109 115 100 115 86S107 64 91 64Z";
const paint = (id, name) => "url(#" + id + "-" + name + ")";

function ArtworkDefinitions({ id }) {
  return (
    <defs>
      <linearGradient id={id + "-silver"} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#fcfcfa" /><stop offset=".42" stopColor="#d0d3d0" />
        <stop offset=".68" stopColor="#f4f4f1" /><stop offset="1" stopColor="#929894" />
      </linearGradient>
      <linearGradient id={id + "-cloth"} x1="0" y1="0" x2="1" y2=".2">
        <stop stopColor="#9ca29e" /><stop offset=".22" stopColor="#e2e4df" />
        <stop offset=".52" stopColor="#f4f4f1" /><stop offset=".82" stopColor="#c1c6c1" />
        <stop offset="1" stopColor="#8c938f" />
      </linearGradient>
      <linearGradient id={id + "-surface"} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#f4f4f1" stopOpacity=".075" />
        <stop offset="1" stopColor="#08090a" stopOpacity=".35" />
      </linearGradient>
      <pattern id={id + "-checker"} width="10" height="10" patternUnits="userSpaceOnUse" stroke="none">
        <rect width="10" height="10" fill="#f4f4f1" fillOpacity=".025" />
        <path d="M0 0H5V5H0ZM5 5H10V10H5Z" fill="#f4f4f1" fillOpacity=".1" />
      </pattern>
      <pattern id={id + "-repeat"} width="28" height="32" patternUnits="userSpaceOnUse" stroke="none">
        <path d="M0 0 14 8 28 0 14-8Z" fill="#f4f4f1" fillOpacity=".8" />
        <path d="M0 0 14 8V24L0 16Z" fill="#f4f4f1" fillOpacity=".42" />
        <path d="M14 8 28 0V16L14 24Z" fill="#f4f4f1" fillOpacity=".13" />
        <path d="M0 0 14 8 28 0M14 8V24" stroke="#f4f4f1" strokeOpacity=".22" strokeWidth=".7" />
      </pattern>
      <clipPath id={id + "-jersey"}><path d={JERSEY} /></clipPath>
      <clipPath id={id + "-pattern"}><rect x="47" y="39" width="109" height="109" rx="7" /></clipPath>
      <clipPath id={id + "-photo"}><rect x="29" y="22" width="134" height="132" rx="12" /></clipPath>
    </defs>
  );
}

function Surface({ id, x = 29, y = 22, width = 134, height = 132 }) {
  return <rect x={x} y={y} width={width} height={height} rx="12" fill={paint(id, "surface")} strokeOpacity=".32" />;
}

function Jersey({ id, printed = false }) {
  return (
    <>
      <path d={JERSEY} fill={paint(id, "cloth")} stroke="#f4f4f1" strokeOpacity=".6" />
      {printed && (
        <g clipPath={paint(id, "jersey")} stroke="none">
          <path d="M19 73 81 37V50L19 86Z" fill="#f4f4f1" fillOpacity=".72" />
          <path d="M19 89 81 53V72L19 108Z" fill="#08090a" fillOpacity=".37" />
          <path d="M19 93 81 57" stroke="#f4f4f1" strokeOpacity=".65" strokeWidth="1" />
          <path d="M57 34H66V41Q61.5 47 57 41Z" fill="#08090a" fillOpacity=".32" />
        </g>
      )}
      <path d="M38 4C40 23 60 23 62 4L65 6C60 27 40 27 35 6Z" fill="#08090a" fillOpacity=".3" stroke="none" />
      <path d="M26 12 28 28M74 12 72 28M9 34 19 40M81 40 91 34M25 101Q50 108 75 101" stroke="#08090a" strokeOpacity=".24" strokeWidth=".8" />
      <path d="M29 33 31 89M71 33 69 89" stroke="#08090a" strokeOpacity=".09" strokeWidth="1.5" />
      <path d="M32 37 34 88" stroke="#ffffff" strokeOpacity=".25" strokeWidth=".7" />
    </>
  );
}

function GarmentArtwork({ id }) {
  return (
    <>
      <Surface id={id} />
      <path d="M47 31H38V40M145 31H154V40M38 136V145H47M154 127V136" strokeOpacity=".72" strokeWidth="1.2" />
      <path d="M38 49V127M56 145H113M56 31H137" strokeOpacity=".13" strokeDasharray="2 4" />
      <g transform="translate(52 35) scale(.85)"><Jersey id={id} /></g>
      <rect x="123" y="111" width="43" height="43" rx="7" fill="#151818" stroke="#b5bcb6" strokeOpacity=".6" />
      <path d="M135 119Q144 124 153 119L156 144Q144 149 132 144Z" fill={paint(id, "silver")} strokeOpacity=".6" strokeWidth=".7" />
      <path d="M140 130 144 134 150 127" stroke="#08090a" strokeWidth="1.3" strokeOpacity=".65" />
    </>
  );
}

function VectorArtwork({ id }) {
  const nodes = [[65, 46], [91, 46], [134, 86], [91, 127], [65, 127]];
  return (
    <>
      <Surface id={id} />
      <path d="M48 23V153M75 23V153M102 23V153M129 23V153M30 48H162M30 75H162M30 102H162M30 129H162" strokeOpacity=".055" strokeWidth=".7" />
      <path d={VECTOR_MARK} fill={paint(id, "silver")} fillRule="evenodd" strokeOpacity=".7" strokeWidth=".8" />
      <path d="M65 37V137M91 46H121M134 62V110M91 127H119" strokeOpacity=".42" strokeWidth=".8" />
      {[[121, 46], [134, 62], [134, 110], [119, 127]].map(([x, y]) => <circle key={x + "-" + y} cx={x} cy={y} r="1.7" fill="#f4f4f1" stroke="none" />)}
      {nodes.map(([x, y]) => <rect key={x + "-" + y} x={x - 2.5} y={y - 2.5} width="5" height="5" rx=".6" fill="#141717" stroke="#f4f4f1" strokeWidth="1" />)}
      <path d="M39 141H53M39 141V127" strokeOpacity=".45" strokeWidth="1" />
    </>
  );
}

function PatternArtwork({ id }) {
  return (
    <>
      <Surface id={id} x={27} y={21} width={118} height={118} />
      <path d="M35 33H132M35 41H132M35 49H132M35 57H132" strokeOpacity=".1" strokeWidth=".7" />
      <rect x="42" y="34" width="119" height="119" rx="11" fill="#151918" strokeOpacity=".5" />
      <g clipPath={paint(id, "pattern")}>
        <rect x="47" y="39" width="109" height="109" fill={paint(id, "repeat")} stroke="none" />
        <path d="M48 94H155M102 40V147" strokeOpacity=".15" strokeDasharray="2 3" strokeWidth=".8" />
      </g>
      <rect x="47" y="39" width="109" height="109" rx="7" strokeOpacity=".18" strokeWidth=".8" />
      <path d="M66 25H120M116 22 120 25 116 28M169 60V117M166 113 169 117 172 113" strokeOpacity=".55" strokeWidth="1" />
      <path d="M36 149V159H46" strokeOpacity=".35" />
    </>
  );
}

function CutoutArtwork({ id }) {
  return (
    <>
      <Surface id={id} />
      <g clipPath={paint(id, "photo")}>
        <rect x="96" y="22" width="68" height="132" fill={paint(id, "checker")} stroke="none" />
        <path d="M96 23V67M96 134V154" strokeOpacity=".35" strokeWidth=".8" />
        <path d="M43 109C43 99 50 85 56 72L65 69C73 86 86 88 96 91L111 99 134 102Q146 103 150 114L147 126H49Q41 124 43 117Z" fill={paint(id, "cloth")} strokeOpacity=".65" strokeWidth="1" />
        <path d="M43 115Q94 124 149 113L147 126Q98 136 47 127Z" fill={paint(id, "silver")} strokeOpacity=".55" strokeWidth=".8" />
        <path d="M56 74Q61 90 80 89M55 91Q72 100 94 107L134 111M131 103 137 111M50 122Q91 130 140 122" stroke="#08090a" strokeOpacity=".25" strokeWidth=".8" />
        <path d="M80 92 87 86M88 97 95 91M97 101 104 96" stroke="#08090a" strokeOpacity=".6" strokeWidth="1.5" />
        <path d="M38 106C40 94 47 80 53 69L66 64C76 82 86 82 99 88L114 95 138 99Q152 101 155 114" strokeOpacity=".5" strokeDasharray="2 3" strokeWidth=".8" />
      </g>
      <path d="M43 137V151L48 146 52 153 55 151 51 144H58Z" fill={paint(id, "silver")} stroke="#151818" strokeWidth="1" />
      <path d="M143 35H153M148 30V40" strokeOpacity=".5" strokeWidth="1" />
    </>
  );
}

function MockupArtwork({ id }) {
  return (
    <>
      <Surface id={id} />
      <path d="M39 143H151M39 147H151" strokeOpacity=".12" strokeWidth=".8" />
      <g transform="translate(99 43) scale(.57)" opacity=".48"><Jersey id={id} /></g>
      <path d="M107 40H143M143 40V66" strokeOpacity=".25" strokeDasharray="2 3" strokeWidth=".8" />
      <g transform="translate(45 32) scale(.94)"><Jersey id={id} printed /></g>
      <path d="M42 137H54M42 137V125M146 135H153M153 135V128" strokeOpacity=".6" strokeWidth="1" />
      <circle cx="152" cy="36" r="2" fill="#f4f4f1" fillOpacity=".7" stroke="none" />
    </>
  );
}

const ARTWORK = { garment: GarmentArtwork, logo: VectorArtwork, pattern: PatternArtwork, bg_remover: CutoutArtwork, mockup_studio: MockupArtwork };

export default function WorkspaceCategoryArtwork({ variant }) {
  const id = useId().replace(/:/g, "");
  const Artwork = ARTWORK[variant];
  if (!Artwork) return null;
  return (
    <svg viewBox="0 0 192 176" fill="none" stroke="#f4f4f1" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" data-workspace-artwork={variant}>
      <ArtworkDefinitions id={id} />
      <Artwork id={id} />
    </svg>
  );
}
