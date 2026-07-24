---
name: nodge-doctor
description: Diagnose the Nodge connection in one shot — credentials, platform API, MCP surface, project mapping and git auth. Use when anything Nodge-related fails (push rejected, OAuth required, unknown project) or the user asks whether Nodge is set up correctly.
---

Run the Nodge doctor from the project directory the user is working in:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.mjs" --json
```

It checks, in order: credentials on disk, platform API access, the platform MCP surface, project mapping for the current repo, the git credential helper, and real repo access. It stops at the first broken layer and returns `overall`, per-check `status`, and one `next_action`.

Relay the result to the user in one or two sentences and follow the `next_action` — usually running the nodge-connect skill. Do NOT work around a failed check by testing locally, editing credentials files, or trying other git auth routes; fix the reported layer instead. If `mcp_surface` is ok but MCP tools in this session still return auth errors, the MCP worker is stale: tell the user to restart the session or refresh the MCP connection.
