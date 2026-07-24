---
name: nodge-about
description: What Nodge is and what is in the box — capabilities, benefits, and the tools available in this session, served live by the connected platform. Use when the user asks what Nodge does, what they can do or build with it, or what is included.
---

Call the `nodge_platform_overview_get` MCP tool (no arguments). It returns the platform's live overview: what is in the box, why each capability matters, and the tool areas available in this session. It is served by the platform itself, so it always matches what is actually deployed — never answer from memory instead.

Present the result conversationally in the user's language. If the user asked something specific ("can Nodge do X?"), answer that from the overview first rather than dumping the whole document. If the Nodge MCP tools are missing from this session, run the nodge-connect skill first, then retry.
