<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Codex Efficiency Guidelines

- Prioritize accuracy, minimal changes, and efficient token usage.
- Inspect only files relevant to the requested task initially.
- Avoid unnecessary full-repository scans and broad searches.
- Reuse existing code, components, utilities, and architecture.
- Avoid repeatedly reading unchanged files.
- Do not refactor unrelated functionality.
- Preserve all existing production functionality.
- Never modify production AI prompts unless explicitly authorized.
- Do not modify payment integrations, Supabase security policies, database migrations, or authentication logic without task-specific authorization.
- Avoid unnecessary tool calls and repeated terminal commands.
- Use targeted tests and checks when sufficient.
- Run broader tests when required for correctness or security.
- Keep final explanations concise and informative.
- Expand investigation when necessary instead of sacrificing correctness.
- Never skip essential validation solely to reduce token usage.
- Before making major architectural changes, explain why they are necessary.

## Required brand colors and UI direction

Use this approved DesaynClaw palette for all new and updated UI. These are the brand colors to follow; do not introduce alternate brand palettes.

| Role | Name | Color |
| --- | --- | --- |
| Brand yellow / accent | Brand Yellow | `#FFD700` |
| Main background | Neutral Black | `#0B0B0B` |
| Secondary background / inputs | Carbon | `#111315` |
| Panels / cards / subtle shapes | Graphite | `#1A1C1E` |
| Borders / dividers | Neutral border | `#333333` |
| Main text | Soft White | `#F4F4F1` |
| Secondary text | Silver Gray | `#929591` |
| Warning / error accent | Muted Rose | `#D98484` |

- Never use pure black (`#000000`, `#000`, or equivalent RGB/named colors) for UI surfaces. Use Neutral Black (`#0B0B0B`, shared CSS token `--dc-bg`) for main page and canvas backgrounds. This replaces the previous `#08090A` background; preserve Carbon inputs and Graphite panels for contrast.
- Use these surface and text colors consistently in workspaces and controls; do not substitute the previous pure-black/white palette.
- Design Extract uses Carbon (`#111315`) for its continuous canvas surface, including the area behind the floating toolbar, to improve visibility. Keep artwork and transparency previews unchanged.

- Keep the overall UI minimal, professional, and consistent with a Vercel-inspired dark interface.
- Use yellow sparingly for brand details and key primary actions. Preserve `#FFD700`; use neutral surface contrast, Soft White text, and subtle borders for routine tabs and selected rows. Avoid yellow stripes and widespread yellow selection states.
- Keep backgrounds, borders, and text neutral. Do not introduce green, olive, or other colored tints into these surfaces.
- Use Muted Rose (`#D98484`, CSS token `--dc-warning`) for warning/error icons, headings, and subtle outline accents. Keep warning surfaces Graphite and body text Silver Gray; avoid bright red fills. This semantic accent is an exception to the neutral text/border rule above.
- Preserve original colors in user artwork, images, logos, and supplied assets. The UI palette must not recolor their content.
- Preserve the connected, screen-filling workspace layout. Do not add floating main panels, outer gaps, or a new layout without an explicit request.
- Keep UI changes within the requested scope; do not redesign unrelated components when adjusting colors or spacing.

- Use a consistent 2px border weight for bordered UI controls and cards across DesaynClaw. Keep structural dividers thin and preserve intentionally borderless controls and artwork boundaries.
- Premium crowns are visual-only indicators for included advanced actions. Use a small 12px outline crown after the label: Brand Yellow on dark buttons; on Soft White buttons, keep the crown Brand Yellow on a small Carbon backing for contrast. No glow, additional charge, or access restriction. Hide crowns during processing and on routine saved-file downloads; use the tooltip “Advanced feature · Included”.
- Inspector action lists use compact, left-aligned rows rather than stacked white action buttons. New-feature badges use Brand Yellow with Obsidian text, 9px type, and a 3px radius; pair with the crown after the action label. Hide both badges while processing and on saved-file downloads. New badges remain for the current release until explicitly removed; they do not change billing or access.
