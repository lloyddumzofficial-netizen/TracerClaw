"use client";
import { useEffect, useRef, useState } from "react";
export default function useLayerPagination(items, enabled = true) {
  const viewport = useRef(null);
  const [size, setSize] = useState(4);
  const [requestedPage, setPage] = useState(0);
  useEffect(() => {
    const element = viewport.current;
    if (!element || !enabled) return;
    const measure = () => {
      const style = getComputedStyle(element);
      const row = parseFloat(style.getPropertyValue("--layer-row-height")) || 56;
      const gap = parseFloat(style.getPropertyValue("--layer-row-gap")) || 4;
      setSize(Math.max(1, Math.floor((element.clientHeight + gap) / (row + gap))));
    };
    const observer = new ResizeObserver(measure); observer.observe(element); measure();
    return () => observer.disconnect();
  }, [enabled, items.length]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = Math.min(requestedPage, pages - 1);
  const start = page * size;
  return { viewport, items: items.slice(start, start + size), total: items.length, page, pages, start, end: Math.min(start + size, items.length),
    next: () => setPage(value => Math.min(value + 1, pages - 1)), previous: () => setPage(value => Math.max(0, value - 1)), reset: () => setPage(0),
    reveal: id => { const index = items.findIndex(item => item.id === id); if (index >= 0) setPage(Math.floor(index / size)); },
  };
}
