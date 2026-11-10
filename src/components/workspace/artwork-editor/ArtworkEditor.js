"use client";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Brush, Check, Eraser, Hand, ImagePlus, Loader2, LockKeyhole, Minus, Plus, Scan, Square, Trash2, Undo2, X } from "lucide-react";
import { MAX_SELECTION_SHAPES, validateEditInstructions } from "@/lib/artworkEdits";
import ArtworkEditCanvas from "./ArtworkEditCanvas";
import ArtworkInstructionEditor from "./ArtworkInstructionEditor";
import WorkspaceProcessingLoader from "../WorkspaceProcessingLoader";
import styles from "./ArtworkEditor.module.css";
import aiOutlineStyles from "@/components/ui/AiOutlineButton.module.css";
import { instructionFingerprint, instructionStatus } from "./instructionState";
import { selectionBounds } from "./selectionGeometry";
import useSelectionDiagnostics from "./useSelectionDiagnostics";

function loadDraft(key, { prefix, sourceUrl }) {
  try {
    for (const savedKey of Object.keys(localStorage)) {
      if (!savedKey.startsWith("artwork-edit:v1:")) continue;
      try { if (JSON.parse(localStorage.getItem(savedKey)).expiresAt < Date.now()) localStorage.removeItem(savedKey); } catch { localStorage.removeItem(savedKey); }
    }
    const stored = localStorage.getItem(key);
    // Revision-only refreshes must not erase work drawn on the exact same
    // immutable source URL. A different image never inherits these selections.
    const previousKey = !stored && Object.keys(localStorage).filter(savedKey => savedKey.startsWith(prefix)
      && /^\d+:/.test(savedKey.slice(prefix.length)) && savedKey.endsWith(`:${sourceUrl}`))
      .sort((a, b) => Number(b.slice(prefix.length).split(":")[0]) - Number(a.slice(prefix.length).split(":")[0]))[0];
    const draft = JSON.parse(stored || (previousKey ? localStorage.getItem(previousKey) : null));
    if (draft?.instructions?.length) {
      // Validate geometry before rendering SVG; drafts may contain unfinished prompts.
      const instructions = draft.instructions.slice(0, 5).map((item, index) => {
        const shapes = Array.isArray(item.shapes) ? item.shapes : [];
        // Migrate older local drafts that accumulated rectangles into one current region.
        const lastRectangle = shapes.findLastIndex(shape => shape.kind === "rect");
        const currentShapes = shapes.slice(Math.max(0, lastRectangle)).slice(0, MAX_SELECTION_SHAPES);
        return { id: index + 1, automatic: item.automatic === true, savedFingerprint: typeof item.savedFingerprint === "string" && item.savedFingerprint.length <= 262144 ? item.savedFingerprint : undefined, prompt: typeof item.prompt === "string" ? item.prompt.slice(0, 1000) : "", shapes: currentShapes.length ? validateEditInstructions([{ ...item, shapes: currentShapes, prompt: "Draft" }])[0].shapes : [] };
      });
      return { instructions, requestKey: !previousKey && /^[A-Za-z0-9_-]{16,100}$/.test(draft.requestKey || "") ? draft.requestKey : crypto.randomUUID() };
    }
  } catch { /* An invalid/obsolete local draft must never prevent opening the editor. */ }
  return { instructions: [{ id: 1, prompt: "", shapes: [] }], requestKey: crypto.randomUUID() };
}

export default function ArtworkEditor({ project, userId, editing, onClose }) {
  const draftKey = `artwork-edit:v1:${userId}:${project.id}:${project.artwork_revision || 0}:${project.generated_image_url}`;
  const expiresAt = Date.parse(project.created_at) + 3 * 86400000;
  const [draft, setDraft] = useState(() => loadDraft(draftKey, { prefix: `artwork-edit:v1:${userId}:${project.id}:`, sourceUrl: project.generated_image_url }));
  const [activeId, setActiveId] = useState(1);
  const [tool, setTool] = useState("rectangle");
  const [brushSize, setBrushSize] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [review, setReview] = useState(false);
  const [selectedId, setSelectedId] = useState(() => editing.edits.find(e => e.status === "processing" || (["ready", "refunded"].includes(e.status) && e.base_revision === (project.artwork_revision || 0) && e.source_url === project.generated_image_url))?.id || null);
  const [compare, setCompare] = useState(true);
  const [reviewedPreviewId, setReviewedPreviewId] = useState(null);
  const [commentPosition, setCommentPosition] = useState(null);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [focusRequest, setFocusRequest] = useState(null);
  const canvasContainer = useRef(null);
  const root = useRef(null);
  const editor = useRef(null);
  const selectionHistory = useRef({});
  const keyboard = useRef(null);
  const commentOpen = useRef(false);
  commentOpen.current = Boolean(commentPosition);
  const pending = editing.edits.find(e => e.status === "processing");
  const selected = editing.edits.find(e => e.id === selectedId) || pending;
  const result = selected?.status === "ready" && selected.base_revision === (project.artwork_revision || 0) && selected.source_url === project.generated_image_url ? selected : null;
  const requiresBoundaryReview = result?.error_code === "EDIT_BOUNDARY_REVIEW";
  const canApply = !editing.busy && (!requiresBoundaryReview || reviewedPreviewId === result?.id);
  const failure = selected?.status === "refunded" && selected.base_revision === (project.artwork_revision || 0) && selected.source_url === project.generated_image_url ? selected : null;
  const selectionLocked = editing.busy || review || Boolean(failure);
  const active = draft.instructions.find(item => item.id === activeId);
  const diagnostics = useSelectionDiagnostics(draft.instructions, imageSize);
  const conflictingIds = new Set(diagnostics.pairs.flat());
  const source = result?.source_url || project.generated_image_url;
  const applied = editing.edits.find(e => e.status === "applied" && e.result_url === project.generated_image_url);
  useEffect(() => {
    // Keep reserved canvas room during a pointer gesture so image coordinates
    // stay stable. Release it after an explicit close, review, or generation.
    if (review || editing.busy || (!commentPosition && !root.current?.hasAttribute("data-artwork-drawing"))) canvasContainer.current?.removeAttribute("data-composer-space");
  }, [commentPosition, review, editing.busy]);
  useEffect(() => { try { if (expiresAt > Date.now()) localStorage.setItem(draftKey, JSON.stringify({ ...draft, expiresAt })); } catch { /* Storage may be disabled. */ } }, [draft, draftKey, expiresAt]);
  useEffect(() => { if (pending) setSelectedId(pending.id); }, [pending?.id]);
  useEffect(() => {
    if (selected?.status === "ready" || selected?.status === "refunded") { setReview(false); setCommentPosition(null); }
  }, [selected?.id, selected?.status]);
  useEffect(() => {
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; root.current?.focus();
    const onKey = event => {
      if (event.key === "Escape") { event.preventDefault(); if (commentOpen.current) { setCommentPosition(null); root.current?.focus({ preventScroll: true }); } else onClose(); return; }
      keyboard.current?.(event);
      if (event.key === "Tab") {
        const focusable = [...root.current.querySelectorAll('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === root.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === root.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    const node = root.current; node.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; node.removeEventListener("keydown", onKey); previous?.focus(); };
  }, [onClose]);
  const update = instructions => { setDraft({ instructions, requestKey: crypto.randomUUID() }); setReview(false); setSelectionNotice(""); editing.setError(""); };
  const shapes = (id, value) => {
    selectionHistory.current[id] = [...(selectionHistory.current[id] || []), draft.instructions.find(item => item.id === id)?.shapes || []].slice(-20);
    update(draft.instructions.map(item => item.id === id ? { ...item, shapes: value } : item));
  };
  const undoSelection = () => {
    const previous = selectionHistory.current[activeId]?.pop();
    update(draft.instructions.map(item => item.id === activeId ? { ...item, shapes: previous || item.shapes.slice(0, -1) } : item));
    setCommentPosition(null);
  };
  const focusArea = item => {
    const bounds = selectionBounds(item.shapes, imageSize.height / imageSize.width || 1);
    if (!bounds) return;
    setZoom(Math.max(1, Math.min(4, .75 / Math.max(bounds.width, bounds.height))));
    setFocusRequest({ id: item.id, bounds, token: crypto.randomUUID() });
  };
  const select = id => {
    const item = draft.instructions.find(row => row.id === id);
    setActiveId(id); root.current?.focus({ preventScroll: true });
    if (item?.shapes.some(shape => !shape.erase)) { focusArea(item); setCommentPosition({ instructionId: id }); }
    else setCommentPosition(null);
  };
  const closeComposer = () => { setCommentPosition(null); canvasContainer.current?.removeAttribute("data-composer-space"); root.current?.focus({ preventScroll: true }); };
  const compose = id => {
    if (selectionLocked) return;
    setActiveId(id);
    setCommentPosition({ instructionId: id });
  };
  const remove = id => { const items = draft.instructions.filter(item => item.id !== id).map((item, index) => ({ ...item, id: index + 1 })); update(items.length ? items : [{ id: 1, prompt: "", shapes: [] }]); setActiveId(1); selectionHistory.current = {}; setCommentPosition(null); };
  const add = () => { const id = draft.instructions.length + 1; update([...draft.instructions, { id, prompt: "", shapes: [] }]); select(id); };
  const saveInstruction = () => {
    try { validateEditInstructions([active]); } catch (error) { editing.setError(error.message); return; }
    const savedInstructions = draft.instructions.map(item => item.id === activeId ? { ...item, savedFingerprint: instructionFingerprint(item) } : item);
    const unused = draft.instructions.find(item => item.id !== activeId && !item.shapes.length && !item.prompt.trim());
    let nextId = unused?.id;
    if (!nextId && draft.instructions.length < 5) {
      nextId = draft.instructions.length + 1;
      savedInstructions.push({ id: nextId, prompt: "", shapes: [], automatic: true });
    }
    update(savedInstructions);
    editing.setError("");
    setSelectionNotice(nextId ? `Instruction ${activeId} saved. Draw the next area, or review your edits.` : savedInstructions.every(item => instructionStatus(item) === "Saved") ? "All five instructions are ready. Review your edits to continue." : `Instruction ${activeId} saved. Save the remaining drafts before reviewing.`);
    if (nextId) setActiveId(nextId);
    setTool("rectangle");
    closeComposer();
  };
  const prepare = () => {
    try {
      // An untouched automatic next slot is an invitation, not a submitted edit.
      const instructions = draft.instructions.filter(item => !item.automatic || item.shapes.length || item.prompt.trim()).map((item, index) => ({ ...item, id: index + 1 }));
      validateEditInstructions(instructions);
      if (diagnostics.checking) throw new Error("Checking selection boundaries. Please try again in a moment.");
      if (diagnostics.pairs.length) throw new Error("Selections overlap. Adjust the highlighted areas before reviewing.");
      if (diagnostics.emptyIds?.length) throw new Error(`Selection ${diagnostics.emptyIds[0]} is empty. Draw an area before reviewing.`);
      const unsaved = instructions.find(item => instructionStatus(item) !== "Saved");
      if (unsaved) throw new Error(`Save instruction ${unsaved.id} before reviewing your edits.`);
      if (instructions.length !== draft.instructions.length) { update(instructions); setActiveId(instructions.at(-1).id); selectionHistory.current = {}; }
      editing.setError(""); setReview(true);
    }
    catch (error) { editing.setError(error.message); }
  };
  const generate = async () => {
    const edit = await editing.generate({ requestKey: draft.requestKey, sourceRevision: project.artwork_revision || 0, sourceUrl: project.generated_image_url, instructions: draft.instructions.map(({ id, prompt, shapes }) => ({ id, prompt, shapes })) });
    if (edit) { setSelectedId(edit.id); setReview(false); }
  };
  const discard = () => { setSelectedId(null); setReview(false); setDraft(value => ({ ...value, requestKey: crypto.randomUUID() })); editing.setError(""); };
  const reviewFailedInstructions = () => {
    // Replaying the failed request key would only return that old refund.
    // Prepare a new draft; nothing is submitted until the user confirms again.
    const instructions = failure.instructions.map((item, index) => ({ id: index + 1, prompt: item.prompt, shapes: item.shapes, savedFingerprint: instructionFingerprint(item) }));
    update(instructions); setSelectedId(null); setActiveId(1); setTool("rectangle");
    selectionHistory.current = {}; setCommentPosition(null);
    setSelectionNotice("Instructions restored. Check the full text and outline are inside your selection, then review before generating.");
  };
  const history = editing.edits.filter(e => ["ready", "refunded"].includes(e.status) && e.base_revision === (project.artwork_revision || 0) && e.source_url === project.generated_image_url);
  const readyCount = draft.instructions.filter(item => instructionStatus(item) === "Saved").length;
  const draftCount = draft.instructions.filter(item => instructionStatus(item) !== "Saved" && (item.prompt.trim() || item.shapes.length)).length;
  const activeBounds = active ? selectionBounds(active.shapes, imageSize.height / imageSize.width || 1) : null;
  const edgeWarning = activeBounds && (activeBounds.x <= .001 || activeBounds.y <= .001 || activeBounds.x + activeBounds.width >= .999 || activeBounds.y + activeBounds.height >= .999);
  keyboard.current = event => {
    if (event.target.closest('textarea,input,select,[contenteditable="true"]') || selectionLocked || result) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undoSelection(); return; }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const next = { r: "rectangle", b: "brush", e: "erase", h: "pan" }[event.key.toLowerCase()];
    if (next) { event.preventDefault(); setTool(next); setCommentPosition(null); }
  };
  return <div className={styles.overlay}>
    <section ref={root} className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="artwork-editor-title" tabIndex={-1}>
      <header className={styles.header}><span className={styles.headerIcon}><ImagePlus size={18} /></span><div><h2 id="artwork-editor-title">Edit artwork</h2><p>{project.name || "Flat artwork"}</p></div><div className={styles.workflowSteps} aria-label="Editing workflow"><span data-current={!review && !result && !failure}><b>01</b> Select & describe</span><span data-current={review || Boolean(result) || Boolean(failure)}><b>02</b> Review & apply</span></div><button className={styles.iconButton} onClick={onClose} aria-label="Close artwork editor"><X size={18} /></button></header>
      <div className={styles.body}>
        <div className={styles.canvasColumn}>
          <div className={styles.toolbar}>
            {!result && <div className={styles.toolGroup} role="group" aria-label="Selection tools">{[["rectangle", Square, "Rectangle", "R"], ["brush", Brush, "Brush", "B"], ["erase", Eraser, "Erase selection", "E"], ["pan", Hand, "Pan", "H"]].map(([id, Icon, label, shortcut]) => <button key={id} className={tool === id ? styles.selectedTool : ""} onClick={() => { setTool(id); setCommentPosition(null); }} disabled={selectionLocked} title={`${label} (${shortcut})`} aria-label={label} aria-keyshortcuts={shortcut} aria-pressed={tool === id}><Icon size={14} /><span>{id === "erase" ? "Erase" : label}</span><kbd>{shortcut}</kbd></button>)}</div>}
            {!result && (tool === "brush" || tool === "erase") && <label className={styles.brushSize}>Size<input type="range" min="1" max="25" value={brushSize} onChange={e => setBrushSize(Number(e.target.value))} aria-label="Brush size" /></label>}
            {result && <label className={styles.resultFocus}>Inspect<select aria-label="Inspect edited area" value={focusRequest?.id || ""} onChange={event => {
              const item = result.instructions.find(row => row.id === Number(event.target.value));
              if (item) focusArea(item); else { setFocusRequest(null); setZoom(1); }
            }}><option value="">Full artwork</option>{result.instructions.map(item => <option key={item.id} value={item.id}>Selection {String(item.id).padStart(2, "0")}</option>)}</select></label>}
            <div className={styles.zoom}><button onClick={() => setZoom(z => Math.max(.25, z - .25))} aria-label="Zoom out"><Minus size={14} /></button><span>{Math.round(zoom * 100)}%</span><button onClick={() => setZoom(z => Math.min(4, z + .25))} aria-label="Zoom in"><Plus size={14} /></button><button className={styles.fitButton} onClick={() => setZoom(1)} aria-label="Fit artwork"><Scan size={13} /><span>Fit</span></button></div>
          </div>
          <div className={styles.canvasContainer} ref={canvasContainer}>
            <ArtworkEditCanvas source={source} instructions={failure?.instructions || draft.instructions} activeId={activeId} onCompose={compose} onInteractionStart={() => setCommentPosition(null)} onShapes={shapes} onLimit={editing.setError} tool={tool} brushSize={brushSize} zoom={zoom} disabled={selectionLocked} result={result?.result_url} compare={compare} focusRequest={focusRequest} onImageSize={setImageSize} conflictingIds={conflictingIds} />
            {commentPosition && active && !selectionLocked && !result && <ArtworkInstructionEditor
              instruction={active} canvasRef={canvasContainer} onClose={closeComposer} onSave={saveInstruction} warning={conflictingIds.has(activeId) ? "This area overlaps another selection. Adjust the boxes before reviewing." : edgeWarning ? "This selection reaches the artwork edge. Check that the full target is inside." : ""}
              onChange={prompt => update(draft.instructions.map(item => item.id === activeId ? { ...item, prompt } : item))} />}
            {editing.busy && <div className={styles.processing}><WorkspaceProcessingLoader previewUrl={`/api/proxy?url=${encodeURIComponent(source)}`} label="Editing artwork" detail="Applying your instructions inside the selected areas" stageCount={1} stageLabels={["Artwork edit"]} /></div>}
          </div>
          <div className={styles.canvasFooter}><span>{failure ? "Original artwork. No changes applied." : result ? compare ? "Drag the divider · Before on the left, After on the right" : "Edited preview. Check the changes before applying." : tool === "rectangle" ? "Drag to select · Drag inside to move · Pull an edge to resize" : tool === "pan" ? "Drag the canvas to pan. Use Fit to return to the full artwork." : `Brush strokes: ${active?.shapes.filter(shape => shape.kind === "brush").length || 0}/${MAX_SELECTION_SHAPES}. Only selected pixels can change.`}</span>{!result && !failure && <div className={styles.selectionActions}><button disabled={(!active?.shapes.length && !selectionHistory.current[activeId]?.length) || editing.busy || review} onClick={undoSelection} title="Undo selection (Ctrl / ⌘ Z)"><Undo2 size={13} /> Undo</button><button disabled={!active?.shapes.length || editing.busy || review} onClick={() => { shapes(activeId, []); setCommentPosition(null); }}><Trash2 size={13} /> Clear area</button></div>}</div>
        </div>
        <aside className={styles.sidebar}>
          <div className={styles.sideHeading}><strong>{failure ? "Edit status" : result ? "Edited preview" : review ? "Confirm your instructions" : "Instructions"}</strong><span>{failure ? "Not applied" : result ? "1K PNG" : `${draft.instructions.length}/5`}</span></div>
          <div className={styles.sideContent}>
            {failure ? <>
              <section className={styles.failureNotice} role="status" aria-label="Edit outcome">
                <AlertCircle size={18} aria-hidden="true" />
                <h3>Edit not applied</h3>
                <p>{["EDIT_FRAME_CHANGED", "EDIT_OUTSIDE_SELECTION"].includes(failure.error_code)
                  ? "The AI moved artwork outside your selected area. We rejected this preview to avoid a cropped or misaligned edit."
                  : failure.error_code === "PROVIDER_BALANCE" ? "The AI provider could not complete this edit. Try again when the processing service is available."
                  : "This edit could not be completed. No usable preview was saved."}</p>
                <p>Your Claw has been refunded. Your source artwork is unchanged.</p>
              </section>
              <p className={styles.failureGuidance}>{["EDIT_FRAME_CHANGED", "EDIT_OUTSIDE_SELECTION"].includes(failure.error_code) ? "Include the complete lettering and its outer outline in your selection. Review the area and instruction before trying again." : "Your instructions are saved. Review them before submitting another generation."}</p>
              <ol className={styles.reviewList}>{failure.instructions.map(item => <li key={item.id}><span>{item.id}</span><p>{item.prompt}</p></li>)}</ol>
            </> : result ? <>
              <h3>Review first.<br /><span>Apply when it’s right.</span></h3><p>Your edit is a separate preview. Applying it updates the flat artwork; upscale and SVG outputs must then be rebuilt.</p>
              {requiresBoundaryReview && <section className={styles.previewWarning} role="status" aria-label="Preview edge warning">
                <AlertCircle size={16} aria-hidden="true" /><div><strong>Check the selection edges</strong><p>The AI changed some surrounding context. We kept your original pixels outside the selection, so this preview may have clipped lettering or a visible seam. Inspect the spelling and complete outline before applying.</p></div>
              </section>}
              <label className={styles.check}><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} /> Compare with original</label>
              <ol className={styles.reviewList}>{result.instructions.map(item => <li key={item.id}><span>{item.id}</span><p>{item.prompt}</p></li>)}</ol>
            </> : review ? <><h3>Ready to edit?</h3><p>All instructions will be sent in one generation.</p><ol className={styles.reviewList}>{draft.instructions.map(item => <li key={item.id}><span>{item.id}</span><p>{item.prompt}</p></li>)}</ol><div className={styles.costNotice}><strong>1 Claw total</strong><p>A completed preview costs 1 Claw, including one that needs correction or is discarded. Review spelling and selection edges before applying. Failed requests with no saved preview are refunded.</p></div></> : <>
              <div className={styles.sideIntro}><p>Select an area and describe the change.<br />Save to start your next instruction.</p></div>
              {selectionNotice && <p className={styles.selectionNotice} role="status"><Check size={13} />{selectionNotice}</p>}
              {diagnostics.pairs.length > 0 && <div className={styles.conflictNotice} role="alert"><AlertCircle size={14} /><div><strong>Overlapping selections</strong>{diagnostics.pairs.map(([first, second]) => <p key={`${first}:${second}`}>Selections {String(first).padStart(2, "0")} and {String(second).padStart(2, "0")} overlap.</p>)}<span>Move or resize these areas, or combine the instructions.</span></div></div>}
              {diagnostics.emptyIds?.length > 0 && <p className={styles.error} role="alert">Selection {diagnostics.emptyIds.join(", ")} has no editable pixels. Draw an area or undo the eraser stroke.</p>}
              <div className={styles.instructionList}>{draft.instructions.map(item => <div className={`${styles.instruction} ${item.id === activeId ? styles.activeInstruction : ""} ${conflictingIds.has(item.id) ? styles.conflictInstruction : ""}`} key={item.id} data-instruction-id={item.id} data-status={instructionStatus(item)}>
                <div className={styles.instructionTop}><button onClick={() => select(item.id)} aria-current={item.id === activeId ? "true" : undefined}><div><strong>Selection {String(item.id).padStart(2, "0")}</strong><small>{instructionStatus(item) === "Saved" && <Check size={11} aria-hidden="true" />}{conflictingIds.has(item.id) ? `${instructionStatus(item)} · overlap` : !item.shapes.length ? "Draw an area to begin" : instructionStatus(item)}</small></div></button><button onClick={() => remove(item.id)} disabled={editing.busy} aria-label={`Delete instruction ${item.id}`}><Trash2 size={13} /></button></div>
                {!item.shapes.length && !item.prompt.trim() ? <div className={styles.nextSelection}><Square size={17} /><span>Draw the next rectangle.<small>Or choose Review edits when you’re done.</small></span></div> : item.id === activeId && !commentPosition ? <><label className={styles.srOnly} htmlFor={`edit-instruction-${item.id}`}>Instruction {item.id}</label><textarea ref={editor} id={`edit-instruction-${item.id}`} maxLength={1000} value={item.prompt} disabled={editing.busy} data-gramm="false" data-enable-grammarly="false" placeholder="e.g. Change the lettering to black. Keep its shape and position." onChange={e => update(draft.instructions.map(row => row.id === item.id ? { ...row, prompt: e.target.value } : row))} /><div className={styles.instructionMeta}><span>{instructionStatus(item)}</span><span>{item.prompt.length}/1000</span></div><button className={styles.inlineSave} onClick={saveInstruction}><Check size={12} /> Save instruction</button></> : <button className={styles.collapsedPrompt} onClick={() => select(item.id)}>{item.prompt || "Describe the change in the canvas card…"}</button>}
              </div>)}</div>
              <button className={styles.addInstruction} disabled={draft.instructions.length >= 5 || editing.busy} onClick={add}><Plus size={14} /> Add instruction</button>
              {history.length > 0 && <div className={styles.history}><label htmlFor="edit-history">Edit history</label><select id="edit-history" value="" disabled={editing.busy} onChange={e => setSelectedId(e.target.value)}><option value="" disabled>Open a previous attempt</option>{history.map((edit, index) => <option value={edit.id} key={edit.id}>Edit {history.length - index} · {edit.status === "refunded" ? "Refunded" : "Preview ready"} · {new Date(edit.created_at).toLocaleString()}</option>)}</select></div>}
              {applied && <button className={styles.restore} disabled={editing.busy} onClick={async () => { if (await editing.apply(applied.id, true)) onClose(); }}><Undo2 size={14} /> Restore previous artwork</button>}
            </>}
          </div>
          <footer className={styles.actions}>
            {editing.error && <p className={styles.error} role="alert">{editing.error}</p>}
            {requiresBoundaryReview && <label className={`${styles.check} ${styles.previewAcknowledgement}`}><input type="checkbox" checked={reviewedPreviewId === result.id} onChange={event => setReviewedPreviewId(event.target.checked ? result.id : null)} /> I checked the spelling and selection edges.</label>}
            {!result && !review && !failure && <div className={styles.reviewMeta}><span>{readyCount > 0 ? `${readyCount} ready` : draftCount > 0 ? "Save your instruction" : "Select an area"}{readyCount > 0 && draftCount > 0 ? ` · ${draftCount} unsaved` : ""}</span><span><b>1 Claw</b> total</span></div>}
            {failure ? <button className={styles.primary} disabled={editing.busy} onClick={reviewFailedInstructions}>Review instructions</button> : result ? <><button className={styles.primary} disabled={!canApply} onClick={async () => { if (canApply && await editing.apply(result.id)) { try { localStorage.removeItem(draftKey); } catch {} onClose(); } }}><Check size={15} /> Apply edit</button><div className={styles.actionRow}><button disabled={editing.busy} onClick={discard}>Discard preview</button><a href={`/api/proxy?url=${encodeURIComponent(result.result_url)}&download=artwork-edit.png`} download="artwork-edit.png">Download PNG</a></div></> : review ? <><button className={styles.primary} disabled={editing.busy} onClick={generate}>{editing.busy ? <Loader2 className={styles.spin} size={15} /> : <ImagePlus size={15} />} Generate edit · 1 Claw</button><button disabled={editing.busy} onClick={() => setReview(false)}>Back to instructions</button></> : <button className={`${styles.primary} ${aiOutlineStyles.outline}`} disabled={editing.busy || diagnostics.checking || diagnostics.pairs.length > 0} onClick={prepare}><span className={aiOutlineStyles.label}>{editing.busy ? "Editing artwork…" : "Review edits"}</span></button>}
            <small><LockKeyhole size={11} aria-hidden="true" /> Private. Deleted with your project.</small>
          </footer>
        </aside>
      </div>
    </section>
  </div>;
}
