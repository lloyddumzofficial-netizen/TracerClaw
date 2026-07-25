/**
 * Geometry for a callout that points at a button.
 *
 * Pure and DOM-free so the placement rules can be tested directly. The caller
 * supplies measured rectangles and applies the returned coordinates.
 *
 * @param {{left:number,right:number,top:number,height:number}} anchor - target button rect
 * @param {{width:number,height:number}} nudge - callout size
 * @param {{width:number,height:number}} viewport
 * @param {number} [gap] - space between callout and button
 * @param {number} [edge] - minimum distance from any viewport edge
 * @returns {{left:number, top:number, side:"left"|"right", arrowY:number}}
 *          `side` is which edge of the callout the arrow sits on: "right" means
 *          the callout is left of the button and points rightward at it.
 */
export function computeNudgePlacement({ anchor, nudge, viewport, gap = 14, edge = 12 }) {
  // Prefer the left of the button; flip to the right only when there is no room.
  let side = "right";
  let left = anchor.left - nudge.width - gap;

  if (left < edge) {
    side = "left";
    left = anchor.right + gap;
  }

  // Never let the card hang off either edge, even after flipping.
  const maxLeft = Math.max(edge, viewport.width - nudge.width - edge);
  left = Math.min(Math.max(left, edge), maxLeft);

  // Vertically centre on the button, clamped inside the viewport.
  const centeredTop = anchor.top + anchor.height / 2 - nudge.height / 2;
  const maxTop = Math.max(edge, viewport.height - nudge.height - edge);
  const top = Math.min(Math.max(centeredTop, edge), maxTop);

  // Keep the arrow level with the button's centre even when the card is clamped,
  // but never so close to a corner that it detaches from the card's border.
  const ARROW_INSET = 14;
  const rawArrowY = anchor.top + anchor.height / 2 - top;
  const arrowY = Math.min(Math.max(rawArrowY, ARROW_INSET), Math.max(ARROW_INSET, nudge.height - ARROW_INSET));

  return { left: Math.round(left), top: Math.round(top), side, arrowY: Math.round(arrowY) };
}
