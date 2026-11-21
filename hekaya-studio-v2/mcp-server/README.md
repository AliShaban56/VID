# Hekaya MCP connector prototype

Endpoint: `/api/mcp` (Vercel function). MCP protocol initialization and tool calls are served over POST JSON-RPC.

## Current tools
- `hekaya_health`: read-only DB connection check.
- `hekaya_list_projects`: read projects.
- `hekaya_get_library`: read projects/scenes/jobs and media URLs.
- `hekaya_get_project_scenes`: read scenes for a given project ID.

## Authentication and scope
Current prototype uses a single bearer token via `HEKAYA_MCP_TOKEN`. This is **not OAuth**, not user consent, and not appropriate for public distribution. Do not share or expose this token. Before offering broad ChatGPT connector access, replace it with an OAuth authorization server flow (authorization code + PKCE, dynamic client registration as required by host, token endpoint, consent/approval screen, revocation, scoped tokens and secure persistence). Publishing and paid generation are intentionally not exposed by this read-only prototype.

## ChatGPT compatibility
This endpoint is a prototype and has not been verified through ChatGPT's connector UI. Use the current official ChatGPT MCP connector instructions and test in a development environment first; the endpoint is not certified or guaranteed to connect from first attempt.

## Hosting
Set `HEKAYA_MCP_TOKEN` only as a Vercel sensitive environment variable. Do not put secrets in Git. The MCP URL on the Hekaya deployment is `https://hekaya-studio-v3-sigma.vercel.app/api/mcp` only if the deployment serves the project's API route at that path; verify deployment and response before sharing.
