# Nodge plugin for Claude Code

Bundles the Nodge platform MCP connection and commit-context capture hooks as one installable unit.

## What it does

- **MCP**: connects Claude Code to `https://platform.<domain>/api/mcp` (spec-compliant Streamable HTTP). OAuth is automatic — the first tool use triggers the sign-in flow (`/mcp` to re-authenticate). Set `NODGE_DOMAIN` before launching Claude Code to target a non-default platform (defaults to `nodge.ai`).
- **Commit-context hooks**: on TodoWrite / AskUserQuestion / ExitPlanMode / Stop, one raw event is staged to the platform. On `git push`, the platform folds staged events into a per-commit context blob readable via the `nodge_commit_context_get` tool. Fold rules live server-side.
- **Commands**: `/nodge-connect [domain]` (installs the Nodge CLI from the platform when `~/.nodge/cli` is missing, then delegates sign-in + git auth to it — one auth implementation, OAuth client `nodge-cli`; separate from the MCP OAuth, which Claude Code manages internally), `/nodge-clone <slug>` and `/nodge-about` (what's in the box — served live by the platform via `nodge_platform_overview_get`).

## Install

From the public marketplace repo (CI-published mirror of this directory):

```
claude plugin marketplace add https://github.com/CoreCubes/nodge-plugin
claude plugin install nodge@nodge
```

Self-hosted / offline: download `nodge-plugin.zip` from your platform (IDE page → plugin download), unzip, then `claude plugin marketplace add <unzipped folder>` + `claude plugin install nodge@nodge`.

Local development: `claude --plugin-dir ./nodge-plugin`, validate with `claude plugin validate ./nodge-plugin --strict`.

## Codex

This directory is a dual-format plugin: `.claude-plugin/` for Claude Code, `.codex-plugin/` for
Codex. Codex install (no manual file copying):

```
codex plugin marketplace add <this repo or unzipped folder>
/plugins   → install "Nodge"
```

That wires the MCP server ([codex/mcp.json](codex/mcp.json) — edit the URL for a non-default
platform), the hard Stop hook for commit-context summaries ([codex/hooks.json](codex/hooks.json)),
and the nodge-connect / nodge-clone skills. Run the nodge-connect skill once so the hook has
credentials. Codex's planner tool is not hook-interceptable, so plan/progress capture stays
Claude-Code-only; hosts with no hooks at all (Claude Desktop, Cursor) are instructed via the MCP
connection to record context with the `nodge_context_stage` tool (best-effort).

## Sidecar (autonomous agents)

The studio sidecar ships the same hooks. It authenticates with env vars instead of `/nodge-connect`:

- `NODGE_AGENT_TOKEN` — the project agent token (sent as `X-Agent-Token`)
- `NODGE_PLATFORM_URL` — in-cluster platform base URL

## Credential storage

`~/.nodge/credentials.json` (0600): domain, access token (1h JWT), rotating refresh token (30d), and the `client_id` that signed in (`nodge-cli` after `/nodge-connect`, since it delegates to the Nodge CLI — the file is shared with the CLI, and token refresh is client-bound server-side). Hooks silently no-op when not connected, when the repo's `origin` isn't the connected platform's git host, or on any error — they never block a turn.
