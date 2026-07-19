"use client";

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";

function scaleSvgToContainer(svgText) {
  return svgText.replace(/<svg([^>]*?)>/i, (_, attrs) => {
    let clean = attrs;
    const wMatch = attrs.match(/\swidth=["']([^"']+)["']/i);
    const hMatch = attrs.match(/\sheight=["']([^"']+)["']/i);
    const vMatch = attrs.match(/\sviewBox=["']([^"']+)["']/i);

    clean = clean
      .replace(/\s+width=["'][^"']*["']/gi, "")
      .replace(/\s+height=["'][^"']*["']/gi, "")
      .replace(/\s+preserveAspectRatio=["'][^"']*["']/gi, "")
      .replace(/\s+style=["'][^"']*["']/gi, "");

    if (!vMatch && wMatch && hMatch) {
      const w = parseFloat(wMatch[1].replace(/px/i, ""));
      const h = parseFloat(hMatch[1].replace(/px/i, ""));
      if (!Number.isNaN(w) && !Number.isNaN(h)) {
        clean += ` viewBox="0 0 ${w} ${h}"`;
      }
    }

    return `<svg${clean} style="width:100%;height:100%;display:block;" preserveAspectRatio="xMidYMid meet">`;
  });
}

export default function SafeInlineSVG({ url, style, fallbackToImage = false, loadingFallback = null }) {
  const [svgHtml, setSvgHtml] = useState(null);
  const [loading, setLoading] = useState(false);
  const [useImageFallback, setUseImageFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!url) {
      setSvgHtml(null);
      setUseImageFallback(false);
      setLoading(false);
      return;
    }

    if (fallbackToImage && !url.toLowerCase().endsWith(".svg") && !url.toLowerCase().includes("svg")) {
      setSvgHtml(null);
      setUseImageFallback(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setSvgHtml(null);
    setUseImageFallback(false);

    fetch(url)
      .then((r) => r.text())
      .then((text) => {
        if (cancelled) return;

        const safe = DOMPurify.sanitize(text, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onbegin", "onend"],
        });

        if (safe.includes("<svg")) {
          setSvgHtml(scaleSvgToContainer(safe));
        } else if (fallbackToImage) {
          setUseImageFallback(true);
        }
      })
      .catch((err) => {
        console.error("[SafeInlineSVG] fetch failed:", err);
        if (!cancelled && fallbackToImage) setUseImageFallback(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fallbackToImage, url]);

  if (useImageFallback) {
    return <img src={url} alt="" style={style} />;
  }

  if (loading && loadingFallback) return loadingFallback;
  if (!svgHtml) return null;
  return <div style={{ ...style, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}
