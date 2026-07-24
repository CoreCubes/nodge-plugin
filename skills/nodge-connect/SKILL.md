---
name: nodge-connect
description: Sign this machine in to the Nodge platform so commit-context capture works. Use when the user asks to connect to Nodge or when Nodge hooks report they are not connected.
---

Run the Nodge connect flow. Execute exactly:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/connect.mjs" <domain>
```

Where `<domain>` is the Nodge domain the user names; omit it to use the NODGE_DOMAIN environment variable, then the nodge.ai default. The script first installs the Nodge CLI from the platform if `~/.nodge/cli` is missing (may take ~30 seconds; installer output streams through), then hands sign-in to the CLI, which opens a browser for OAuth and configures git access. It is safe to re-run: when already connected it exits immediately. Wait for it to finish and relay its final line to the user. If it fails, show the error and suggest `/nodge-doctor` or retrying with the correct domain.
