---
name: nodge-clone
description: Clone a Nodge project repo by slug. Use when the user asks to clone or pull down a Nodge project.
---

Clone the Nodge project the user named (a project slug).

1. Determine the git host: read `~/.nodge/credentials.json` and use `git.<domain>`. If that file doesn't exist, run the nodge-connect skill first, or ask for their Nodge domain.
2. Resolve the repo path: call the Nodge MCP tool `nodge_projects_list` and match the project by slug to get its `forgejo_org` and `forgejo_repo`. If MCP is unavailable, ask the user for the org name.
3. Run `git clone https://git.<domain>/<org>/<repo>.git` in the directory the user wants (ask if unclear — default to the current directory).
4. Confirm the clone succeeded and tell the user to `cd` into it; the Nodge hooks pick it up automatically from the git remote.
