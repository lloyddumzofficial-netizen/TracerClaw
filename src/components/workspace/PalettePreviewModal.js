"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import PaletteCanvas from "./PaletteCanvas";
import PaletteColorMapPanel from "./PaletteColorMapPanel";
import PaletteFooter from "./PaletteFooter";
import {
  DEFAULT_BUBBLE_LAYOUT,
  MAX_SWATCHES,
  clamp,
  colorDistance,
  extractPalette,
  filterPalette,
  getSvgDimensions,
  getSvgSize,
  normalizeColor,
  replacePaletteColor,
  sanitizeSvg,
  sortPalette,
} from "./PalettePreviewModal.utils";

const LARGE_COLOR_THRESHOLD = 120;
const LARGE_PAINT_THRESHOLD = 2500;
const LARGE_SVG_KB_THRESHOLD = 900;

// History holds full SVG snapshots. Capping only the entry count meant a 900KB
// SVG could retain ~11MB, so bound the retained bytes too and drop the oldest
// entries first. Both limits are generous for normal artwork.
const HISTORY_MAX_ENTRIES = 24;
const HISTORY_MAX_BYTES = 8 * 1024 * 1024;

// Recoloring re-parses and re-serializes the whole SVG, so live preview while
// dragging the picker is only affordable below this size. Larger files still
// recolor, just on release instead of continuously.
const LIVE_PREVIEW_MAX_BYTES = 400 * 1024;

function pushHistoryEntry(entries, entry) {
  const next = [...entries, entry];
  let bytes = next.reduce((sum, item) => sum + (item.svgText?.length || 0), 0);
  while (next.length > 1 && (next.length > HISTORY_MAX_ENTRIES || bytes > HISTORY_MAX_BYTES)) {
    bytes -= next[0].svgText?.length || 0;
    next.shift();
  }
  return next;
}

function getPaletteItem(palette, color) {
  return palette.find(item => item.color === color) || null;
}

function normalizeMergeGroup(group, fallbackItem, palette) {
  const items = Array.isArray(group) && group.length > 0
    ? group
    : fallbackItem
      ? [{ color: fallbackItem.color, count: fallbackItem.count }]
      : [];

  return items
    .map(child => (
      typeof child === "string"
        ? { color: child, count: getPaletteItem(palette, child)?.count || 0 }
        : { color: child?.color, count: child?.count || 0 }
    ))
    .filter(child => child.color);
}

function mergeVisualGroups({ palette, mergeGroups, sourceItem, targetItem }) {
  const sourceGroup = normalizeMergeGroup(mergeGroups[sourceItem.color], sourceItem, palette);
  const targetGroup = normalizeMergeGroup(mergeGroups[targetItem.color], null, palette)
    .filter(child => child.color !== targetItem.color);
  const mergedChildren = [...targetGroup, ...sourceGroup]
    .filter(child => child.color !== targetItem.color)
    .reduce((items, child) => {
      if (items.some(item => item.color === child.color)) return items;
      return [...items, child];
    }, []);

  const nextGroups = { ...mergeGroups };
  delete nextGroups[sourceItem.color];
  return {
    ...nextGroups,
    [targetItem.color]: mergedChildren,
  };
}

function remapMergeGroupsForRecolor(mergeGroups, previousColor, nextColor) {
  if (!previousColor || !nextColor || previousColor === nextColor) return mergeGroups;
  const nextGroups = {};
  Object.entries(mergeGroups).forEach(([groupColor, children]) => {
    const nextGroupColor = groupColor === previousColor ? nextColor : groupColor;
    nextGroups[nextGroupColor] = normalizeMergeGroup(children, null, [])
      .map(child => ({
        ...child,
        color: child.color === previousColor ? nextColor : child.color,
      }))
      .filter(child => child.color !== nextGroupColor);
  });
  return nextGroups;
}

const PalettePreviewModal = memo(function PalettePreviewModal({
  show,
  project,
  onClose,
  onCompare,
  onApplyEditedSvg,
}) {
  const [palette, setPalette] = useState([]);
  const [sizeLabel, setSizeLabel] = useState("SVG vector");
  const [loading, setLoading] = useState(false);
  const [originalSvgText, setOriginalSvgText] = useState("");
  const [editedSvgText, setEditedSvgText] = useState("");
  const [selectedColor, setSelectedColor] = useState(null);
  const [hexInput, setHexInput] = useState("#ffd700");
  const [bubbleLayout, setBubbleLayout] = useState(DEFAULT_BUBBLE_LAYOUT);
  const [childBubbleLayout, setChildBubbleLayout] = useState({});
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [editHistory, setEditHistory] = useState([]);
  const [redoHistory, setRedoHistory] = useState([]);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteSort, setPaletteSort] = useState("usage");
  // Non-committed recolor shown while the picker is being dragged.
  const [previewSvgText, setPreviewSvgText] = useState(null);
  const [dragMergeColor, setDragMergeColor] = useState(null);
  const [mergeTargetColor, setMergeTargetColor] = useState(null);
  const [mergeGroups, setMergeGroups] = useState({});
  const [paletteMode, setPaletteMode] = useState("select");
  const [isApplying, setIsApplying] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);

  const dragRef = useRef(null);
  const childDragRef = useRef(null);
  const previewDragRef = useRef(null);
  const previewPanFrameRef = useRef(null);
  const bubbleFrameRef = useRef(null);
  const childBubbleFrameRef = useRef(null);
  const editorRef = useRef(null);
  const suppressClickRef = useRef(false);
  const livePreviewRef = useRef({ frame: null, pending: null });

  const svgUrl = useMemo(() => (
    project?.svg_url ? `/api/proxy?url=${encodeURIComponent(project.svg_url)}` : null
  ), [project?.svg_url]);

  useEffect(() => {
    let cancelled = false;
    if (!show || !svgUrl) {
      setPalette([]);
      setSizeLabel("SVG vector");
      setOriginalSvgText("");
      setEditedSvgText("");
      setSelectedColor(null);
      setShowApplyConfirm(false);
      return;
    }

    setLoading(true);
    fetch(svgUrl)
      .then(res => res.text())
      .then(text => {
        if (cancelled) return;
        const nextPalette = extractPalette(text);
        setOriginalSvgText(text);
        setEditedSvgText(text);
        setPalette(nextPalette);
        setSelectedColor(nextPalette[0]?.color || null);
        setHexInput(nextPalette[0]?.color || "#ffd700");
        setBubbleLayout(DEFAULT_BUBBLE_LAYOUT);
        setChildBubbleLayout({});
        setViewZoom(1);
        setViewPan({ x: 0, y: 0 });
        setEditHistory([]);
        setRedoHistory([]);
        setPreviewSvgText(null);
        setPaletteQuery("");
        setPaletteSort("usage");
        setDragMergeColor(null);
        setMergeTargetColor(null);
        setMergeGroups({});
        setPaletteMode("select");
        setShowApplyConfirm(false);
        setSizeLabel(getSvgSize(text));
      })
      .catch(() => {
        if (!cancelled) setPalette([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (previewPanFrameRef.current) cancelAnimationFrame(previewPanFrameRef.current);
      if (bubbleFrameRef.current) cancelAnimationFrame(bubbleFrameRef.current);
      if (childBubbleFrameRef.current) cancelAnimationFrame(childBubbleFrameRef.current);
      if (livePreviewRef.current.frame) cancelAnimationFrame(livePreviewRef.current.frame);
      livePreviewRef.current = { frame: null, pending: null };
    };
  }, [show, svgUrl]);

  const featured = useMemo(() => palette.slice(0, 5), [palette]);
  const visiblePalette = useMemo(() => palette.slice(0, MAX_SWATCHES), [palette]);
  const paletteClusters = useMemo(() => {
    if (featured.length === 0) return [];
    return featured.map(anchor => {
      const members = visiblePalette
        .filter(item => item.color !== anchor.color)
        .map(item => ({ ...item, distance: colorDistance(anchor.color, item.color) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 24);
      return [anchor, ...members];
    });
  }, [featured, visiblePalette]);

  const displayPalette = useMemo(
    () => sortPalette(filterPalette(visiblePalette, paletteQuery), paletteSort),
    [visiblePalette, paletteQuery, paletteSort]
  );

  const selectedItem = palette.find(item => item.color === selectedColor) || palette[0] || null;
  // While the picker is being dragged the canvas shows the uncommitted preview.
  const renderedSvgText = previewSvgText || editedSvgText;
  const sanitizedSvg = useMemo(
    () => (renderedSvgText ? sanitizeSvg(renderedSvgText) : ""),
    [renderedSvgText]
  );
  const svgDimensions = useMemo(
    () => (editedSvgText ? getSvgDimensions(editedSvgText) : null),
    [editedSvgText]
  );
  const hasEdits = Boolean(originalSvgText && editedSvgText && originalSvgText !== editedSvgText);
  const svgComplexity = useMemo(() => {
    const paintCount = palette.reduce((sum, item) => sum + item.count, 0);
    return {
      colorCount: palette.length,
      paintCount,
      sizeKb: Math.round((editedSvgText.length || originalSvgText.length || 0) / 1024),
    };
  }, [palette, editedSvgText, originalSvgText]);
  const largeSvgWarning = useMemo(() => {
    if (!svgComplexity.colorCount) return null;
    if (svgComplexity.colorCount > LARGE_COLOR_THRESHOLD) return `${svgComplexity.colorCount} colors found. Editing may be slower on older devices.`;
    if (svgComplexity.paintCount > LARGE_PAINT_THRESHOLD) return `${svgComplexity.paintCount} paint entries found. Keep edits focused for smoother performance.`;
    if (svgComplexity.sizeKb > LARGE_SVG_KB_THRESHOLD) return `${svgComplexity.sizeKb} KB SVG file. Browser export/editing may take a moment.`;
    return null;
  }, [svgComplexity]);
  // Populated just before render returns, so the keyboard effect below always
  // calls the current handlers without re-subscribing on every state change.
  const actionsRef = useRef({});

  useEffect(() => {
    if (!show) return undefined;

    const onKeyDown = (event) => {
      const target = event.target;
      const isTextField = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if (event.key === "Escape") {
        // Let a focused field bail out first rather than closing the whole studio.
        if (isTextField) {
          target.blur();
          return;
        }
        event.preventDefault();
        actionsRef.current.close?.();
        return;
      }

      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();

      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        actionsRef.current.undo?.();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        actionsRef.current.redo?.();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [show]);

  if (!show || !project) return null;

  const commitPaletteEdit = (nextSvgText, preferredColor = selectedColor, options = {}) => {
    if (!nextSvgText || nextSvgText === editedSvgText) return;
    if (options.rememberHistory !== false) {
      setEditHistory(prev => pushHistoryEntry(prev, {
        svgText: editedSvgText,
        selectedColor,
        mergeGroups,
      }));
      // A fresh edit invalidates anything that was undone before it.
      setRedoHistory([]);
    }

    const nextPalette = extractPalette(nextSvgText);
    const nextSelected = nextPalette.find(item => item.color === preferredColor)?.color || nextPalette[0]?.color || null;
    setEditedSvgText(nextSvgText);
    setPalette(nextPalette);
    setSelectedColor(nextSelected);
    setHexInput(nextSelected || "#ffd700");
    setMergeGroups(options.nextMergeGroups || {});
    setChildBubbleLayout({});
  };

  const cancelLivePreview = () => {
    const state = livePreviewRef.current;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = null;
    state.pending = null;
    setPreviewSvgText(null);
  };

  const canLivePreview = editedSvgText.length > 0 && editedSvgText.length <= LIVE_PREVIEW_MAX_BYTES;

  /**
   * Repaint the canvas with an uncommitted color so dragging the picker shows
   * the result immediately. Throttled to one recolor per frame, and always
   * derived from the committed SVG so repeated previews never stack up.
   */
  const previewSelectedColor = (nextColor) => {
    if (!canLivePreview || !selectedItem || !/^#[0-9a-f]{6}$/i.test(nextColor)) return;
    const state = livePreviewRef.current;
    state.pending = nextColor.toLowerCase();
    if (state.frame) return;

    state.frame = requestAnimationFrame(() => {
      state.frame = null;
      const color = livePreviewRef.current.pending;
      if (!color) return;
      setPreviewSvgText(replacePaletteColor(editedSvgText, selectedItem, color));
    });
  };

  const updateSelectedColor = (nextColor) => {
    cancelLivePreview();
    if (!selectedItem || !/^#[0-9a-f]{6}$/i.test(nextColor)) return;
    const nextNormalizedColor = nextColor.toLowerCase();
    const updated = replacePaletteColor(editedSvgText, selectedItem, nextNormalizedColor);
    const nextMergeGroups = remapMergeGroupsForRecolor(mergeGroups, selectedItem.color, nextNormalizedColor);
    commitPaletteEdit(updated, nextNormalizedColor, { nextMergeGroups });
  };

  const resetEdits = () => {
    cancelLivePreview();
    setEditedSvgText(originalSvgText);
    const nextPalette = extractPalette(originalSvgText);
    setPalette(nextPalette);
    setSelectedColor(nextPalette[0]?.color || null);
    setHexInput(nextPalette[0]?.color || "#ffd700");
    setEditHistory([]);
    setRedoHistory([]);
    setMergeGroups({});
    setChildBubbleLayout({});
    setShowApplyConfirm(false);
  };

  const mergePaletteColors = (sourceColor, targetColor) => {
    if (!sourceColor || !targetColor || sourceColor === targetColor) return;
    const sourceItem = getPaletteItem(palette, sourceColor);
    const targetItem = getPaletteItem(palette, targetColor);
    if (!sourceItem || !targetItem) return;

    const updated = replacePaletteColor(editedSvgText, sourceItem, targetItem.color);
    const nextMergeGroups = mergeVisualGroups({ palette, mergeGroups, sourceItem, targetItem });
    commitPaletteEdit(updated, targetItem.color, { nextMergeGroups });
  };

  /** Restore a saved snapshot without touching either history stack. */
  const applySnapshot = (snapshot) => {
    const nextPalette = extractPalette(snapshot.svgText);
    const nextSelected = nextPalette.find(item => item.color === snapshot.selectedColor)?.color
      || nextPalette[0]?.color
      || null;
    setEditedSvgText(snapshot.svgText);
    setPalette(nextPalette);
    setSelectedColor(nextSelected);
    setHexInput(nextSelected || "#ffd700");
    setMergeGroups(snapshot.mergeGroups || {});
    setChildBubbleLayout({});
  };

  const currentSnapshot = () => ({ svgText: editedSvgText, selectedColor, mergeGroups });

  const undoLastEdit = () => {
    if (editHistory.length === 0) return;
    cancelLivePreview();
    const previous = editHistory[editHistory.length - 1];
    setRedoHistory(prev => pushHistoryEntry(prev, currentSnapshot()));
    setEditHistory(prev => prev.slice(0, -1));
    applySnapshot(previous);
  };

  const redoLastEdit = () => {
    if (redoHistory.length === 0) return;
    cancelLivePreview();
    const next = redoHistory[redoHistory.length - 1];
    setEditHistory(prev => pushHistoryEntry(prev, currentSnapshot()));
    setRedoHistory(prev => prev.slice(0, -1));
    applySnapshot(next);
  };

  const selectColor = (color, fallbackColor = null) => {
    const requestedColor = color || fallbackColor;
    if (!requestedColor) return;
    const exact = getPaletteItem(palette, requestedColor);
    const fallback = fallbackColor ? getPaletteItem(palette, fallbackColor) : null;
    const closest = exact || fallback || palette.reduce((best, item) => (
      colorDistance(item.color, requestedColor) < colorDistance(best.color, requestedColor) ? item : best
    ), palette[0]);
    if (!closest) return;
    setSelectedColor(closest.color);
    setHexInput(closest.color);
  };

  const handleSelectColor = (color, fallbackColor = null) => {
    if (suppressClickRef.current) return;
    selectColor(color, fallbackColor);
  };

  const findColorFromSvgElement = (element) => {
    if (!element || element.nodeType !== 1 || element.tagName?.toLowerCase() === "svg") return null;
    const directValues = [
      element.getAttribute("fill"),
      element.getAttribute("stroke"),
      element.getAttribute("stop-color"),
      element.style?.fill,
      element.style?.stroke,
      element.style?.stopColor,
    ];
    for (const value of directValues) {
      const color = normalizeColor(value);
      if (color) return color;
    }
    const computed = window.getComputedStyle(element);
    return normalizeColor(computed.fill) || normalizeColor(computed.stroke);
  };

  const zoomPreview = (nextZoom) => {
    setViewZoom(clamp(nextZoom, 0.25, 40));
  };

  const resetPreviewView = () => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  };

  const handlePreviewWheel = (event) => {
    event.preventDefault();
    const multiplier = event.deltaY > 0 ? 0.86 : 1.16;
    zoomPreview(viewZoom * multiplier);
  };

  const startPreviewPan = (event) => {
    previewDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: viewPan.x,
      panY: viewPan.y,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const movePreviewPan = (event) => {
    const drag = previewDragRef.current;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
    drag.nextPan = { x: drag.panX + dx, y: drag.panY + dy };
    if (previewPanFrameRef.current) return;

    previewPanFrameRef.current = requestAnimationFrame(() => {
      previewPanFrameRef.current = null;
      if (previewDragRef.current?.nextPan) setViewPan(previewDragRef.current.nextPan);
    });
  };

  const stopPreviewPan = (event) => {
    const drag = previewDragRef.current;
    if (!drag) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    suppressClickRef.current = drag.moved;
    previewDragRef.current = null;
    if (previewPanFrameRef.current) {
      cancelAnimationFrame(previewPanFrameRef.current);
      previewPanFrameRef.current = null;
    }
    if (drag.nextPan) setViewPan(drag.nextPan);
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const handlePreviewClick = (event) => {
    if (suppressClickRef.current) return;
    selectColor(findColorFromSvgElement(event.target));
  };

  const resetBubbleLayout = () => {
    setBubbleLayout(DEFAULT_BUBBLE_LAYOUT);
    setChildBubbleLayout({});
  };

  const startBubbleDrag = (event, index) => {
    const bubbleRect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      index,
      offsetX: event.clientX - bubbleRect.left,
      offsetY: event.clientY - bubbleRect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveBubble = (event, index) => {
    const drag = dragRef.current;
    if (!drag || drag.index !== index) return;
    const panel = event.currentTarget.parentElement;
    if (!panel) return;

    const panelRect = panel.getBoundingClientRect();
    const layout = bubbleLayout[index] || DEFAULT_BUBBLE_LAYOUT[index];
    const maxX = Math.max(0, 100 - (layout.size / panelRect.width) * 100);
    const maxY = Math.max(0, 100 - (layout.size / panelRect.height) * 100);
    const x = ((event.clientX - panelRect.left - drag.offsetX) / panelRect.width) * 100;
    const y = ((event.clientY - panelRect.top - drag.offsetY) / panelRect.height) * 100;

    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) drag.moved = true;
    drag.nextBubble = { x: clamp(x, 0, maxX), y: clamp(y, 0, maxY) };
    if (bubbleFrameRef.current) return;

    bubbleFrameRef.current = requestAnimationFrame(() => {
      bubbleFrameRef.current = null;
      const nextBubble = dragRef.current?.nextBubble;
      if (!nextBubble) return;
      setBubbleLayout(prev => prev.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...nextBubble } : item
      )));
    });
  };

  const stopBubbleDrag = (event, index) => {
    const drag = dragRef.current;
    if (!drag || drag.index !== index) return;

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    suppressClickRef.current = drag.moved;
    if (bubbleFrameRef.current) {
      cancelAnimationFrame(bubbleFrameRef.current);
      bubbleFrameRef.current = null;
    }
    if (drag.nextBubble) {
      setBubbleLayout(prev => prev.map((item, itemIndex) => (
        itemIndex === index ? { ...item, ...drag.nextBubble } : item
      )));
    }
    if (paletteMode === "merge" && drag.moved) {
      const sourceColor = featured[index]?.color;
      const dropTarget = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map(element => element.closest?.("[data-cluster-color]"))
        .find(element => {
          const color = element?.getAttribute("data-cluster-color");
          return color && color !== sourceColor;
        });
      const targetColor = dropTarget?.getAttribute("data-cluster-color");
      if (sourceColor && targetColor) {
        mergePaletteColors(sourceColor, targetColor);
        setMergeTargetColor(null);
        setDragMergeColor(null);
      }
    }
    dragRef.current = null;
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const startChildBubbleDrag = (event, childKey, startPosition) => {
    event.stopPropagation();
    const childRect = event.currentTarget.getBoundingClientRect();
    childDragRef.current = {
      childKey,
      offsetX: event.clientX - childRect.left,
      offsetY: event.clientY - childRect.top,
      startX: event.clientX,
      startY: event.clientY,
      startPosition,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const moveChildBubble = (event, childKey) => {
    const drag = childDragRef.current;
    if (!drag || drag.childKey !== childKey) return;
    event.stopPropagation();

    const parent = event.currentTarget.parentElement;
    if (!parent) return;

    const parentRect = parent.getBoundingClientRect();
    const x = ((event.clientX - parentRect.left - drag.offsetX) / parentRect.width) * 100;
    const y = ((event.clientY - parentRect.top - drag.offsetY) / parentRect.height) * 100;

    if (Math.abs(event.clientX - drag.startX) > 3 || Math.abs(event.clientY - drag.startY) > 3) {
      drag.moved = true;
    }
    drag.nextChild = { left: clamp(x, 16, 84), top: clamp(y, 16, 84) };
    if (childBubbleFrameRef.current) return;

    childBubbleFrameRef.current = requestAnimationFrame(() => {
      childBubbleFrameRef.current = null;
      const nextChild = childDragRef.current?.nextChild;
      const activeKey = childDragRef.current?.childKey;
      if (!nextChild || !activeKey) return;
      setChildBubbleLayout(prev => ({ ...prev, [activeKey]: nextChild }));
    });
  };

  const stopChildBubbleDrag = (event, childKey) => {
    const drag = childDragRef.current;
    if (!drag || drag.childKey !== childKey) return;
    event.stopPropagation();

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    suppressClickRef.current = drag.moved;
    if (childBubbleFrameRef.current) {
      cancelAnimationFrame(childBubbleFrameRef.current);
      childBubbleFrameRef.current = null;
    }
    if (drag.nextChild) {
      setChildBubbleLayout(prev => ({ ...prev, [childKey]: drag.nextChild }));
    }
    if (paletteMode === "merge" && drag.moved) {
      const sourceColor = childKey.split(":").pop();
      const sourceClusterColor = childKey.split(":")[0];
      const dropTarget = document
        .elementsFromPoint(event.clientX, event.clientY)
        .map(element => element.closest?.("[data-cluster-color]"))
        .find(element => {
          const color = element?.getAttribute("data-cluster-color");
          return color && color !== sourceClusterColor;
        });
      const targetColor = dropTarget?.getAttribute("data-cluster-color");
      if (sourceColor && targetColor && sourceColor !== targetColor) {
        mergePaletteColors(sourceColor, targetColor);
        setMergeTargetColor(null);
        setDragMergeColor(null);
      }
    }
    childDragRef.current = null;
    if (suppressClickRef.current) {
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  };

  const applyEditedSvg = async () => {
    if (!hasEdits || !editedSvgText || !onApplyEditedSvg) return;
    setIsApplying(true);
    try {
      await onApplyEditedSvg(editedSvgText);
      setShowApplyConfirm(false);
    } finally {
      setIsApplying(false);
    }
  };

  actionsRef.current = { undo: undoLastEdit, redo: redoLastEdit, close: onClose };

  return (
    <div className="modal-overlay">
      <div className="palette-modal">
        <header className="palette-header">
          <div className="palette-brand">
            <img src="/logo.png" alt="DesaynClaw" />
          </div>
          <div className="palette-header-meta" aria-label="Palette metadata">
            <span>{palette.length || "..."} colors</span>
            <span>{sizeLabel}</span>
            <strong>{hasEdits ? "Edited" : "Original"}</strong>
          </div>
          <button className="icon-btn-small" onClick={onClose}><X size={16} /></button>
        </header>

        <section className="palette-body">
          <PaletteCanvas
            svgUrl={svgUrl}
            sanitizedSvg={sanitizedSvg}
            selectedColor={selectedColor}
            svgDimensions={svgDimensions}
            sizeLabel={sizeLabel}
            viewZoom={viewZoom}
            viewPan={viewPan}
            onZoom={zoomPreview}
            onResetView={resetPreviewView}
            onWheel={handlePreviewWheel}
            onPointerDown={startPreviewPan}
            onPointerMove={movePreviewPan}
            onPointerUp={stopPreviewPan}
            onClick={handlePreviewClick}
          />

          <PaletteColorMapPanel
            featured={featured}
            paletteClusters={paletteClusters}
            bubbleLayout={bubbleLayout}
            childBubbleLayout={childBubbleLayout}
            selectedColor={selectedColor}
            mergeTargetColor={mergeTargetColor}
            dragMergeColor={dragMergeColor}
            paletteMode={paletteMode}
            hasEdits={hasEdits}
            visiblePalette={visiblePalette}
            displayPalette={displayPalette}
            paletteQuery={paletteQuery}
            paletteSort={paletteSort}
            onSetPaletteQuery={setPaletteQuery}
            onSetPaletteSort={setPaletteSort}
            loading={loading}
            selectedItem={selectedItem}
            hexInput={hexInput}
            mergeGroups={mergeGroups}
            canUndo={editHistory.length > 0}
            canRedo={redoHistory.length > 0}
            canLivePreview={canLivePreview}
            onRedo={redoLastEdit}
            onPreviewSelectedColor={previewSelectedColor}
            onCancelLivePreview={cancelLivePreview}
            editorRef={editorRef}
            largeSvgWarning={largeSvgWarning}
            onStartBubbleDrag={startBubbleDrag}
            onMoveBubble={moveBubble}
            onStopBubbleDrag={stopBubbleDrag}
            onStartChildBubbleDrag={startChildBubbleDrag}
            onMoveChildBubble={moveChildBubble}
            onStopChildBubbleDrag={stopChildBubbleDrag}
            onMergePaletteColors={mergePaletteColors}
            onSetMergeTargetColor={setMergeTargetColor}
            onSetDragMergeColor={setDragMergeColor}
            onSelectColor={handleSelectColor}
            onSetPaletteMode={setPaletteMode}
            onCompare={onCompare}
            onUndo={undoLastEdit}
            onFocusRecolorControls={() => {
              setPaletteMode("select");
              editorRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
            onUpdateSelectedColor={updateSelectedColor}
            onSetHexInput={setHexInput}
          />
        </section>

          <PaletteFooter
          hasEdits={hasEdits}
          isApplying={isApplying}
          onResetLayout={resetBubbleLayout}
          onResetColors={resetEdits}
          onRequestApply={() => {
            if (onApplyEditedSvg) setShowApplyConfirm(true);
          }}
        />

        {showApplyConfirm && (
          <div className="palette-confirm" role="dialog" aria-modal="true" aria-labelledby="palette-confirm-title">
            <div className="palette-confirm-panel">
              <strong id="palette-confirm-title">Apply edited SVG?</strong>
              <p>This will replace the current workspace SVG with your edited palette version. Downloads will use the new SVG after applying.</p>
              <div className="palette-confirm-actions">
                <button type="button" onClick={() => setShowApplyConfirm(false)} disabled={isApplying}>Cancel</button>
                <button type="button" onClick={applyEditedSvg} disabled={isApplying}>
                  {isApplying ? "Applying..." : "Apply changes"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default PalettePreviewModal;
