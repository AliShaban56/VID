# Hekaya Studio MCP Integration

This folder is the planned home for Hekaya's Model Context Protocol (MCP) connector so ChatGPT can call authenticated Hekaya tools directly.

## Security and rollout
- Do not commit credentials, API keys, tokens, or production URLs containing secrets.
- Use a dedicated Hekaya MCP access token and HTTPS.
- Enforce tool-level scopes and confirmation for destructive, paid generation, and publishing actions.
- Keep publishing disabled until separately authorized.
- Do not deploy this integration until the owner expressly approves deployment.

## Planned tool surface
- `hekaya_health`: read-only connection diagnostics.
- `hekaya_list_projects`: read-only project listing.
- `hekaya_create_project`: create project (write).
- `hekaya_submit_story_package`: send story/scenes (write).
- `hekaya_generate_scene_media`: trigger paid media generation (write; explicit confirmation).
- `hekaya_get_job_status`: read-only job status.
- `hekaya_get_library`: read-only asset listing.
- `hekaya_assemble_video`: trigger internal renderer (write; confirmation).
- `hekaya_get_final_video`: retrieve completed render URL (read-only).
- Publishing tools: intentionally excluded from initial connector and require a separate authorization phase.

## Proposed transport and endpoint
Use MCP Streamable HTTP over HTTPS. The endpoint will be `/api/mcp` or a standalone service, depending on hosting constraints. The server must implement MCP initialize, tool listing, and tool invocation, with authentication and scoped authorization.

## Required environment variables (names only)
- `HEKAYA_MCP_TOKEN` (dedicated connector credential; never committed)
- `HEKAYA_RENDERER_URL` (internal renderer endpoint)
- `HEKAYA_RENDERER_TOKEN` (renderer credential)
- Existing database and Magic Hour secrets remain server-side only.

This document is a design scaffold only. No server endpoint has been implemented or deployed yet.