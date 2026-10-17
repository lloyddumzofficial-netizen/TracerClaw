"use client";

import DOMPurify from "dompurify";
import { useEffect, useState } from "react";
import { scaleSvgToContainer } from "@/lib/svgDisplay";

export default function SafeInlineSVG({
  url,
  className,
  style,
  fallbackToImage = false,
  loadingFallback = null,
  imageAlt = "",
  imageLoading = "lazy",
  onReady,
}) {
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

        // Sanitize LAST. scaleSvgToContainer rewrites the <svg …> tag with a
        // regex that stops at the first ">", and attribute values are not
        // ">"-escaped — so running it after DOMPurify lets a surviving
        // data-* attribute containing ">&lt;img src=x onerror=…>" split the tag
        // and smuggle a live element past sanitization.
        const safe = DOMPurify.sanitize(scaleSvgToContainer(text), {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["script", "foreignObject", "iframe", "object", "embed"],
          FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "onbegin", "onend"],
        });

        if (safe.includes("<svg")) {
          setSvgHtml(safe);
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

  useEffect(() => {
    if (!svgHtml || !onReady) return undefined;
    const frame = requestAnimationFrame(() => onReady());
    return () => cancelAnimationFrame(frame);
  }, [onReady, svgHtml]);

  if (useImageFallback) {
    return <img src={url} alt={imageAlt} loading={imageLoading} decoding="async" draggable="false" className={className} style={style} onLoad={onReady} />;
  }

  if (loading && loadingFallback) return loadingFallback;
  if (!svgHtml) return null;
  return <div className={className} style={{ ...style, overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: svgHtml }} />;
}
