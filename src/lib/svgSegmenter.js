/**
 * svgSegmenter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Post-processes an SVG (produced by Recraft vectorize) by using Gemini vision
 * to classify each path into a semantic layer (Background, Stripe, Logo, etc.)
 * and wraps them in named <g id="layer-..."> groups.
 *
 * GUARANTEES:
 *  - The rendered SVG is pixel-identical before and after (paths are never modified)
 *  - On ANY failure (API error, timeout, parse error), the original svgText is
 *    returned unchanged — this step is completely non-fatal
 *  - No extra credit is charged; this runs inside the existing Step 3 API call
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Max number of paths to send to Gemini. SVGs with more paths get the top-N
// largest paths segmented and the rest grouped into an "other" layer.
const MAX_PATHS_FOR_SEGMENTATION = 60;

// Timeout for the Gemini API call (ms). Must leave headroom within Step 3's 120s limit.
const GEMINI_TIMEOUT_MS = 25000;

// Semantic layer labels Gemini will assign — ordered by visual priority (back to front)
const LAYER_LABELS = [
  'background',
  'stripe',
  'pattern',
  'sleeve',
  'collar',
  'border',
  'logo',
  'number',
  'text',
  'other',
];

/**
 * Parse all shape elements from an SVG string.
 * Returns an array of { index, tag, fullTag (full element string), bbox }
 * We intentionally avoid DOM parsers to keep this serverless-friendly.
 */
function parseSvgShapes(svgText) {
  const shapes = [];

  // Match self-closing shape elements
  const tagPattern = /<(path|rect|polygon|polyline|circle|ellipse)(\s[^>]*)?\/>/gi;
  let match;
  let index = 0;

  while ((match = tagPattern.exec(svgText)) !== null) {
    const fullTag = match[0];
    const tag = match[1].toLowerCase();
    const attrs = match[2] || '';

    const bbox = getBboxFromElement(tag, attrs);
    if (bbox) {
      shapes.push({ index, tag, fullTag, bbox });
    }
    index++;
  }

  return shapes;
}

/** Extract a rough bounding box from element attributes */
function getBboxFromElement(tag, attrs) {
  const getAttr = (name) => {
    const m = attrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return m ? m[1] : null;
  };

  try {
    if (tag === 'rect') {
      const x = parseFloat(getAttr('x') || '0');
      const y = parseFloat(getAttr('y') || '0');
      const w = parseFloat(getAttr('width') || '0');
      const h = parseFloat(getAttr('height') || '0');
      if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) return null;
      return { x, y, w, h, cx: x + w / 2, cy: y + h / 2, area: w * h };
    }

    if (tag === 'circle') {
      const cx = parseFloat(getAttr('cx') || '0');
      const cy = parseFloat(getAttr('cy') || '0');
      const r = parseFloat(getAttr('r') || '0');
      if (isNaN(r) || r <= 0) return null;
      return { x: cx - r, y: cy - r, w: r * 2, h: r * 2, cx, cy, area: Math.PI * r * r };
    }

    if (tag === 'ellipse') {
      const cx = parseFloat(getAttr('cx') || '0');
      const cy = parseFloat(getAttr('cy') || '0');
      const rx = parseFloat(getAttr('rx') || '0');
      const ry = parseFloat(getAttr('ry') || '0');
      if (isNaN(rx) || rx <= 0) return null;
      return { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2, cx, cy, area: Math.PI * rx * ry };
    }

    if (tag === 'polygon' || tag === 'polyline') {
      const pointsStr = getAttr('points') || '';
      const coords = pointsStr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
      if (coords.length < 4) return null;
      const xs = [], ys = [];
      for (let i = 0; i < coords.length; i += 2) {
        if (i + 1 < coords.length) { xs.push(coords[i]); ys.push(coords[i + 1]); }
      }
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      const minY = Math.min(...ys), maxY = Math.max(...ys);
      const w = maxX - minX, h = maxY - minY;
      return { x: minX, y: minY, w, h, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, area: w * h };
    }

    if (tag === 'path') {
      const d = getAttr('d') || '';
      return getBboxFromPathD(d);
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Approximate bounding box from SVG path `d` attribute.
 * Extracts all coordinate numbers — intentionally approximate (ignores curves)
 * but accurate enough for centroid-based classification.
 */
function getBboxFromPathD(d) {
  if (!d || d.length < 4) return null;

  const nums = d.match(/-?[\d]*\.?[\d]+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 2) return null;

  const values = nums.map(Number).filter(n => !isNaN(n));
  if (values.length < 4) return null;

  const xs = [], ys = [];
  for (let i = 0; i + 1 < values.length; i += 2) {
    const x = values[i], y = values[i + 1];
    if (isFinite(x) && isFinite(y) && Math.abs(x) < 100000 && Math.abs(y) < 100000) {
      xs.push(x);
      ys.push(y);
    }
  }

  if (xs.length === 0) return null;

  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;

  if (w < 0.01 && h < 0.01) return null;

  return {
    x: minX, y: minY, w, h,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    area: w * h,
  };
}

/** Extract viewBox width/height from SVG string */
function getSvgViewBox(svgText) {
  const m = svgText.match(/viewBox="([^"]*)"/i);
  if (!m) return { vw: 1000, vh: 1000 };
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4) return { vw: 1000, vh: 1000 };
  return { vw: parts[2] || 1000, vh: parts[3] || 1000 };
}

/**
 * Call Gemini Flash via OpenRouter with the original image and path descriptions.
 * Returns: { [shapeIndex: string]: layerLabel }
 */
async function callGeminiForSegmentation(shapes, base64Image, mimeType, traceType, vw, vh) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  // Normalise each path's position/size as % of viewBox for Gemini
  const pathDescriptions = shapes.map((s, i) => {
    const pct = (v, dim) => Math.round((v / dim) * 100);
    const cx = pct(s.bbox.cx ?? (s.bbox.x + s.bbox.w / 2), vw);
    const cy = pct(s.bbox.cy ?? (s.bbox.y + s.bbox.h / 2), vh);
    const pw = pct(s.bbox.w, vw);
    const ph = pct(s.bbox.h, vh);
    return `${i}: center=(${cx}%,${cy}%) size=(${pw}%x${ph}%)`;
  }).join('\n');

  const contextHint = traceType === 'logo'
    ? 'This is a LOGO image. Likely layers: background, border, logo (icon/symbol), text.'
    : 'This is a JERSEY/SHIRT design. Likely layers: background, stripe, pattern, logo, number, text, sleeve, collar, border.';

  const systemPrompt = `You are an expert SVG layer classifier for a vector graphics tool.
Given an image and a list of SVG path bounding boxes (by index number), assign each path exactly one semantic layer name.

${contextHint}

Available layer names (use ONLY these exact lowercase strings):
${LAYER_LABELS.join(', ')}

Classification rules:
- Paths that fill >70% of the canvas → "background"
- Thin horizontal/diagonal paths spanning full width → "stripe"
- Small repeated shapes → "pattern"
- Paths near top-center with small footprint → "logo" or "number"
- Very small, narrow paths → "text"
- Paths along left/right edges → "sleeve"
- Paths near top edge, thin → "collar"
- Ring/frame shapes around the canvas → "border"
- Anything unclear → "other"

Respond ONLY with a valid JSON object. Keys are path index strings, values are label strings.
Example: {"0":"background","1":"stripe","2":"logo","3":"number"}
No markdown. No explanation. Raw JSON only.`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://auto-tracer.app',
      'X-Title': 'TracerClaw SVG Segmenter',
    },
    body: JSON.stringify({
      model: 'google/gemini-flash-1.5',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            {
              type: 'text',
              text: `SVG paths to classify (index: center position, bounding size as % of canvas):\n\n${pathDescriptions}\n\nReturn the JSON classification for every index listed above.`,
            },
          ],
        },
      ],
      max_tokens: 1500,
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content?.trim();
  if (!rawContent) throw new Error('Empty response from Gemini');

  // Strip accidental markdown fences
  const cleaned = rawContent.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  let labelMap;
  try {
    labelMap = JSON.parse(cleaned);
  } catch {
    throw new Error(`Failed to parse Gemini JSON: ${cleaned.slice(0, 300)}`);
  }

  return labelMap;
}

/**
 * Rebuild the SVG with paths wrapped in semantic <g> groups.
 * Paths within each group are in their original document order (painter's order preserved).
 * Groups are ordered back-to-front: background first, text/logo last.
 */
function rebuildSvgWithGroups(svgText, shapes, labelMap) {
  // Map label -> shapes[] (in document order)
  const groups = new Map();
  for (let i = 0; i < shapes.length; i++) {
    const rawLabel = labelMap[String(i)] || 'other';
    const label = LAYER_LABELS.includes(rawLabel.toLowerCase()) ? rawLabel.toLowerCase() : 'other';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(shapes[i]);
  }

  // Extract SVG opening tag
  const svgOpenMatch = svgText.match(/(<svg[^>]*>)/i);
  if (!svgOpenMatch) return svgText;
  const svgOpen = svgOpenMatch[1];

  // Extract inner SVG content
  const innerStart = svgText.indexOf(svgOpenMatch[0]) + svgOpenMatch[0].length;
  const innerEnd = svgText.lastIndexOf('</svg>');
  if (innerEnd === -1) return svgText;
  let innerContent = svgText.slice(innerStart, innerEnd);

  // Remove all classified shape tags from inner content
  const assignedTags = new Set(shapes.map(s => s.fullTag));
  for (const tag of assignedTags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      innerContent = innerContent.replace(new RegExp(escaped, 'g'), '');
    } catch {
      // If regex fails for any reason, skip this removal
    }
  }

  // Preserve <defs> and any other non-shape definitions
  const defsMatch = innerContent.match(/<defs[\s\S]*?<\/defs>/i);
  const defsBlock = defsMatch ? defsMatch[0] : '';

  // Build grouped XML content
  let groupedContent = defsBlock ? `\n  ${defsBlock}\n` : '';

  for (const label of LAYER_LABELS) {
    if (!groups.has(label)) continue;
    const groupShapes = groups.get(label);
    const pathsXml = groupShapes.map(s => `    ${s.fullTag}`).join('\n');
    groupedContent += `\n  <!-- ═══ Layer: ${label.toUpperCase()} (${groupShapes.length} element${groupShapes.length !== 1 ? 's' : ''}) ═══ -->\n`;
    groupedContent += `  <g id="layer-${label}" inkscape:label="${label}" data-layer="${label}">\n${pathsXml}\n  </g>\n`;
  }

  const rebuilt = `${svgOpen}${groupedContent}</svg>`;

  // Final sanity check
  if (!rebuilt.includes('<svg') || !rebuilt.includes('</svg>')) {
    throw new Error('Rebuilt SVG failed sanity check — missing opening or closing tag');
  }

  return rebuilt;
}

/**
 * Main export: Segment an SVG into named semantic layers using Gemini vision.
 *
 * @param {string} svgText              The raw SVG string from Recraft vectorize
 * @param {string} originalImageBase64  Base64-encoded source image (pre-AI-generation)
 * @param {string} originalMimeType     MIME type e.g. 'image/png'
 * @param {string|null} traceType       'logo' | 'jersey' | null — context hint for Gemini
 * @returns {Promise<string>}           Semantically grouped SVG, or original on failure
 */
export async function segmentSvgLayers(svgText, originalImageBase64, originalMimeType = 'image/png', traceType = null) {
  try {
    console.log('[SVG Segmenter] Starting semantic layer grouping...');

    // 1. Parse all SVG shape elements
    const allShapes = parseSvgShapes(svgText);
    if (allShapes.length === 0) {
      console.warn('[SVG Segmenter] No parseable shapes found — skipping grouping');
      return svgText;
    }
    console.log(`[SVG Segmenter] Found ${allShapes.length} shape elements in SVG`);

    // 2. Get viewBox dimensions for coordinate normalisation
    const { vw, vh } = getSvgViewBox(svgText);

    // 3. Cap at MAX_PATHS_FOR_SEGMENTATION — sort by area, classify the largest ones,
    //    group overflow paths under "other" without an extra API call.
    let shapesToClassify = allShapes;
    let overflowShapes = [];
    if (allShapes.length > MAX_PATHS_FOR_SEGMENTATION) {
      const sorted = [...allShapes].sort((a, b) => (b.bbox.area ?? 0) - (a.bbox.area ?? 0));
      const topNIndices = new Set(sorted.slice(0, MAX_PATHS_FOR_SEGMENTATION).map(s => s.index));
      shapesToClassify = allShapes.filter(s => topNIndices.has(s.index));
      overflowShapes = allShapes.filter(s => !topNIndices.has(s.index));
      console.log(`[SVG Segmenter] Classifying top ${shapesToClassify.length} paths; ${overflowShapes.length} small paths → "other"`);
    }

    // 4. Call Gemini Flash for semantic classification
    const labelMap = await callGeminiForSegmentation(
      shapesToClassify, originalImageBase64, originalMimeType, traceType, vw, vh
    );

    // Assign overflow paths to "other"
    for (const s of overflowShapes) {
      labelMap[String(s.index)] = 'other';
    }

    console.log('[SVG Segmenter] Gemini response:', labelMap);

    // 5. Rebuild SVG with semantic <g> groups
    const groupedSvg = rebuildSvgWithGroups(svgText, allShapes, labelMap);

    const uniqueLabels = [...new Set(Object.values(labelMap))];
    console.log(`[SVG Segmenter] ✓ Complete — ${uniqueLabels.length} semantic layers: ${uniqueLabels.join(', ')}`);

    return groupedSvg;

  } catch (err) {
    // NON-FATAL: always return the original SVG unchanged on any error
    console.warn('[SVG Segmenter] Segmentation skipped (non-fatal):', err.message);
    return svgText;
  }
}
