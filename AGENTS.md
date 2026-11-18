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
