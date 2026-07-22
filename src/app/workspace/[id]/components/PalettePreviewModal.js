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
  getSvgSize,
  normalizeColor,
  replacePaletteColor,
  sanitizeSvg,
} from "./PalettePreviewModal.utils";

const LARGE_COLOR_THRESHOLD = 120;
const LARGE_PAINT_THRESHOLD = 2500;
const LARGE_SVG_KB_THRESHOLD = 900;

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
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const [editHistory, setEditHistory] = useState([]);
  const [dragMergeColor, setDragMergeColor] = useState(null);
  const [mergeTargetColor, setMergeTargetColor] = useState(null);
  const [mergeGroups, setMergeGroups] = useState({});
  const [paletteMode, setPaletteMode] = useState("select");
  const [isApplying, setIsApplying] = useState(false);
  const [showApplyConfirm, setShowApplyConfirm] = useState(false);

  const dragRef = useRef(null);
  const previewDragRef = useRef(null);
  const previewPanFrameRef = useRef(null);
  const bubbleFrameRef = useRef(null);
  const editorRef = useRef(null);
  const suppressClickRef = useRef(false);

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
        setViewZoom(1);
        setViewPan({ x: 0, y: 0 });
        setEditHistory([]);
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

  const selectedItem = palette.find(item => item.color === selectedColor) || palette[0] || null;
  const sanitizedSvg = useMemo(
    () => (editedSvgText ? sanitizeSvg(editedSvgText) : ""),
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
  if (!show || !project) return null;

  const commitSvgChange = (nextSvgText, preferredColor = selectedColor, rememberHistory = true) => {
    if (!nextSvgText || nextSvgText === editedSvgText) return;
    if (rememberHistory) setEditHistory(prev => [...prev.slice(-11), editedSvgText]);

    const nextPalette = extractPalette(nextSvgText);
    const nextSelected = nextPalette.find(item => item.color === preferredColor)?.color || nextPalette[0]?.color || null;
    setEditedSvgText(nextSvgText);
    setPalette(nextPalette);
    setSelectedColor(nextSelected);
    setHexInput(nextSelected || "#ffd700");
  };

  const updateSelectedColor = (nextColor) => {
    if (!selectedItem || !/^#[0-9a-f]{6}$/i.test(nextColor)) return;
    const nextNormalizedColor = nextColor.toLowerCase();
    const updated = replacePaletteColor(editedSvgText, selectedItem, nextNormalizedColor);
    commitSvgChange(updated, nextNormalizedColor);
  };

  const resetEdits = () => {
    setEditedSvgText(originalSvgText);
    const nextPalette = extractPalette(originalSvgText);
    setPalette(nextPalette);
    setSelectedColor(nextPalette[0]?.color || null);
    setHexInput(nextPalette[0]?.color || "#ffd700");
    setEditHistory([]);
    setMergeGroups({});
    setShowApplyConfirm(false);
  };

  const mergePaletteColors = (sourceColor, targetColor) => {
    if (!sourceColor || !targetColor || sourceColor === targetColor) return;
    const sourceItem = palette.find(item => item.color === sourceColor);
    const targetItem = palette.find(item => item.color === targetColor);
    if (!sourceItem || !targetItem) return;

    const updated = replacePaletteColor(editedSvgText, sourceItem, targetItem.color);
    commitSvgChange(updated, targetItem.color);
    setMergeGroups(prev => {
      const sourceGroup = prev[sourceColor] || [sourceColor];
      const targetGroup = prev[targetColor] || [targetColor];
      return {
        ...prev,
        [targetColor]: [...new Set([...targetGroup, ...sourceGroup])],
      };
    });
  };

  const undoLastEdit = () => {
    setEditHistory(prev => {
      const previousSvg = prev[prev.length - 1];
      if (!previousSvg) return prev;

      const nextPalette = extractPalette(previousSvg);
      const nextSelected = nextPalette.find(item => item.color === selectedColor)?.color || nextPalette[0]?.color || null;
      setEditedSvgText(previousSvg);
      setPalette(nextPalette);
      setSelectedColor(nextSelected);
      setHexInput(nextSelected || "#ffd700");
      setMergeGroups({});
      return prev.slice(0, -1);
    });
  };

  const selectColor = (color) => {
    if (!color) return;
    const exact = palette.find(item => item.color === color);
    const closest = exact || palette.reduce((best, item) => (
      colorDistance(item.color, color) < colorDistance(best.color, color) ? item : best
    ), palette[0]);
    if (!closest) return;
    setSelectedColor(closest.color);
    setHexInput(closest.color);
  };

  const handleSelectColor = (color) => {
    if (suppressClickRef.current) return;
    selectColor(color);
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
    setViewZoom(clamp(nextZoom, 0.35, 5));
  };

  const resetPreviewView = () => {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  };

  const handlePreviewWheel = (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -0.12 : 0.12;
    zoomPreview(viewZoom + direction);
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
    dragRef.current = null;
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
            selectedColor={selectedColor}
            mergeTargetColor={mergeTargetColor}
            dragMergeColor={dragMergeColor}
            paletteMode={paletteMode}
            hasEdits={hasEdits}
            visiblePalette={visiblePalette}
            loading={loading}
            selectedItem={selectedItem}
            hexInput={hexInput}
            mergeGroups={mergeGroups}
            editHistory={editHistory}
            editorRef={editorRef}
            largeSvgWarning={largeSvgWarning}
            onStartBubbleDrag={startBubbleDrag}
            onMoveBubble={moveBubble}
            onStopBubbleDrag={stopBubbleDrag}
            onMergePaletteColors={mergePaletteColors}
            onSetMergeTargetColor={setMergeTargetColor}
            onSetDragMergeColor={setDragMergeColor}
            onSelectColor={handleSelectColor}
            onSetPaletteMode={setPaletteMode}
            onCompare={onCompare}
            onSplitSelectedColor={undoLastEdit}
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
          onResetLayout={() => setBubbleLayout(DEFAULT_BUBBLE_LAYOUT)}
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
