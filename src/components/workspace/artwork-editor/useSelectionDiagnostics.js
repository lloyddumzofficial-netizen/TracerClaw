"use client";
import { useEffect, useState } from "react";
import { rectangleConflicts } from "./instructionState";

export default function useSelectionDiagnostics(instructions, size) {
  // Prompt typing does not restart geometry checks. Pointer previews never
  // update instructions, so this work only runs after a completed gesture.
  const key = JSON.stringify([size.width, size.height, instructions.map(({ id, shapes }) => ({ id, shapes }))]);
  const [result, setResult] = useState({ key: "", pairs: [] });
  useEffect(() => {
    const [, , regions] = JSON.parse(key);
    if (regions.every(item => !item.shapes.length || (item.shapes.length === 1 && item.shapes[0].kind === "rect"))) {
      setResult({ key, pairs: rectangleConflicts(regions) });
      return;
    }
    if (!size.width || !size.height) return;
    let cancelled = false;
    const canvas = document.createElement("canvas");
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const analyse = async () => {
      try {
        const owners = new Uint8Array(size.width * size.height), pairs = new Map(), emptyIds = [];
        for (let index = 0; index < regions.length; index++) {
          // Yield between masks to keep the editor responsive.
          await new Promise(resolve => setTimeout(resolve, 0));
          if (cancelled) return;
          context.fillStyle = "black"; context.fillRect(0, 0, size.width, size.height);
          for (const shape of regions[index].shapes) {
            context.fillStyle = context.strokeStyle = shape.erase ? "black" : "white";
            if (shape.kind === "rect") { context.fillRect(shape.x * size.width, shape.y * size.height, shape.width * size.width, shape.height * size.height); continue; }
            const radius = shape.radius * size.width, first = shape.points[0];
            context.lineWidth = radius * 2; context.lineCap = context.lineJoin = "round";
            context.beginPath(); context.moveTo(first.x * size.width, first.y * size.height);
            for (const point of shape.points.slice(1)) context.lineTo(point.x * size.width, point.y * size.height);
            context.stroke(); context.beginPath(); context.arc(first.x * size.width, first.y * size.height, radius, 0, Math.PI * 2); context.fill();
          }
          const pixels = context.getImageData(0, 0, size.width, size.height).data;
          let selected = 0;
          for (let pixel = 0; pixel < owners.length; pixel++) {
            if (!pixels[pixel * 4]) continue;
            selected++;
            for (let prior = 0; prior < index; prior++) if (owners[pixel] & (1 << prior)) pairs.set(`${prior}:${index}`, [regions[prior].id, regions[index].id]);
            owners[pixel] |= 1 << index;
          }
          if (regions[index].shapes.length && selected < 4) emptyIds.push(regions[index].id);
        }
        if (!cancelled) setResult({ key, pairs: [...pairs.values()], emptyIds });
      } catch {
        // The server remains authoritative if browser canvas readback fails.
        if (!cancelled) setResult({ key, pairs: [], unavailable: true });
      } finally { canvas.width = canvas.height = 0; }
    };
    analyse();
    return () => { cancelled = true; };
  }, [key, size.width, size.height]);
  return result.key === key ? { ...result, checking: false } : { pairs: [], checking: true };
}
