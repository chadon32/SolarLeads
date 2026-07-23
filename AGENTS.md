<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Local dev server safety

- Do not start detached Node.js or Next.js dev servers directly.
- Use `npm run dev -- --port <port>` so the guarded launcher can prevent duplicate servers.
- Before starting a dev server, check whether the target port is already listening.
- If a local server becomes unresponsive, stop the existing process before starting another one.
- Prefer the default guarded Webpack dev mode unless the user explicitly asks for Turbopack.
