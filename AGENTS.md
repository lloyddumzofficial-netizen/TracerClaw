<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Required brand colors and UI direction

Use this approved DesaynClaw palette for all new and updated UI. These are the brand colors to follow; do not introduce alternate brand palettes.

| Role | Color |
| --- | --- |
| Brand yellow / accent | `#FFD700` |
| Main background | `#000000` |
| Panels / cards | `#0A0A0A` |
| Inputs / secondary surfaces | `#1A1A1A` |
| Borders / dividers | `#333333` |
| Primary text | `#FFFFFF` |
| Secondary text | `#A3A3A3` |

- Keep the overall UI minimal, professional, and consistent with a Vercel-inspired dark interface.
- Use yellow for highlights, selected states, and brand details. Preserve the approved `#FFD700` yellow.
- Keep backgrounds, borders, and text neutral. Do not introduce green, olive, or other colored tints into these surfaces.
- Preserve original colors in user artwork, images, logos, and supplied assets. The UI palette must not recolor their content.
- Preserve the connected, screen-filling workspace layout. Do not add floating main panels, outer gaps, or a new layout without an explicit request.
- Keep UI changes within the requested scope; do not redesign unrelated components when adjusting colors or spacing.
