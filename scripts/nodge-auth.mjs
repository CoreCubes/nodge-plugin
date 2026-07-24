// Shared auth for the Nodge plugin scripts.
//
// Two credential surfaces, resolved in order:
//   1. Sidecar (studio image): NODGE_AGENT_TOKEN env → X-Agent-Token header,
//      platform base URL from NODGE_PLATFORM_URL.
//   2. Local IDE: ~/.nodge/credentials.json written by /nodge-connect
//      (loopback PKCE flow as OAuth client `nodge-claude`). Access tokens are
//      1h JWTs; we refresh via the rotated 30d refresh token when expiring.
//
// Claude Code's own MCP OAuth tokens are internal to Claude Code — hooks can't
// read them, which is why the plugin runs its own flow for the hook scripts.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NODGE_DIR = path.join(os.homedir(), '.nodge');
const CREDS_PATH = path.join(NODGE_DIR, 'credentials.json');
const PROJECT_CACHE_PATH = path.join(NODGE_DIR, 'project-cache.json');

export function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(CREDS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export function saveCreds(creds) {
  fs.mkdirSync(NODGE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), { mode: 0o600 });
}

export function loadProjectCache() {
  try {
    return JSON.parse(fs.readFileSync(PROJECT_CACHE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

export function saveProjectCache(cache) {
  fs.mkdirSync(NODGE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(PROJECT_CACHE_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

async function refreshCreds(creds) {
  const resp = await fetch(`https://platform.${creds.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refresh_token,
      // ~/.nodge/credentials.json is shared with the nodge CLI (platform/cli/),
      // and server-side rotation is client-bound — refresh must use whichever
      // client signed in last. Fallback covers creds written before the
      // client_id field existed.
      client_id: creds.client_id || 'nodge-claude',
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  const next = {
    ...creds,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
  };
  saveCreds(next);
  return next;
}

/**
 * Load local credentials, refreshing the access token when it's about to
 * expire. Returns the full creds object ({ domain, email, access_token, ... })
 * or null when not connected / refresh failed. Used by getAuth() and by the
 * git credential helper, which needs the raw token and email rather than
 * request headers.
 */
export async function getFreshCreds() {
  let creds = loadCreds();
  if (!creds || !creds.access_token || !creds.domain) return null;

  // Refresh a minute early so a slow POST doesn't ride an expired token.
  if (creds.expires_at && creds.expires_at < Date.now() + 60_000) {
    if (!creds.refresh_token) return null;
    creds = await refreshCreds(creds).catch(() => null);
  }
  return creds;
}

/**
 * Resolve auth for a platform call. Returns { baseUrl, headers, domain } or
 * null when nothing is connected (callers should no-op silently).
 */
export async function getAuth() {
  const agentToken = (process.env.NODGE_AGENT_TOKEN || '').trim();
  if (agentToken) {
    const baseUrl = (process.env.NODGE_PLATFORM_URL || '').replace(/\/$/, '');
    if (!baseUrl) return null;
    return { baseUrl, headers: { 'X-Agent-Token': agentToken }, domain: null };
  }

  const creds = await getFreshCreds();
  if (!creds) return null;

  return {
    baseUrl: `https://platform.${creds.domain}`,
    headers: { Authorization: `Bearer ${creds.access_token}` },
    domain: creds.domain,
  };
}
