// /nodge-doctor — one-shot diagnosis of every layer an agent needs:
// credentials on disk, platform API access, MCP surface, project mapping for
// the current directory, git credential helper wiring, and actual repo access.
//
// Prints one line per check plus a single next action; `--json` emits the
// same as machine-readable JSON. Never prints token values.
//
// Usage: node doctor.mjs [--json]   (run from inside a project checkout for
// the project/git checks; elsewhere they report "skipped")

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFreshCreds, loadCreds } from './nodge-auth.mjs';

const asJson = process.argv.includes('--json');
const checks = [];

function add(name, status, message, nextAction = null) {
  checks.push({ name, status, message, ...(nextAction ? { next_action: nextAction } : {}) });
  return status === 'ok' || status === 'skipped';
}

function git(args, opts = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      timeout: 15_000,
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

async function fetchStatus(url, headers) {
  try {
    const resp = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    return resp.status;
  } catch {
    return 0; // network-level failure
  }
}

async function main() {
  // Sidecar mode: agent token auth, no local credentials to diagnose.
  const agentToken = (process.env.NODGE_AGENT_TOKEN || '').trim();
  if (agentToken) {
    const baseUrl = (process.env.NODGE_PLATFORM_URL || '').replace(/\/$/, '');
    const status = baseUrl
      ? await fetchStatus(`${baseUrl}/api/internal/agent/context`, { 'X-Agent-Token': agentToken })
      : 0;
    add('agent_token', status === 200 ? 'ok' : 'failed',
      status === 200 ? 'Sidecar agent token accepted by the platform.'
        : `Platform rejected or unreachable (HTTP ${status}).`,
      status === 200 ? null : 'Check NODGE_PLATFORM_URL / NODGE_AGENT_TOKEN in the sidecar environment.');
    return report();
  }

  // 1. Credentials on disk (with silent refresh attempt).
  const raw = loadCreds();
  if (!raw) {
    add('credentials', 'missing', 'No ~/.nodge/credentials.json.', 'Run /nodge-connect to sign in.');
    return report();
  }
  const creds = await getFreshCreds();
  if (!creds) {
    add('credentials', 'expired',
      `Credentials for ${raw.domain} exist but the token expired and refresh failed.`,
      'Run /nodge-connect to sign in again.');
    return report();
  }
  add('credentials', 'ok', `Signed in to ${creds.domain}${creds.email ? ` as ${creds.email}` : ''}; token is fresh.`);

  const base = `https://platform.${creds.domain}`;
  const bearer = { Authorization: `Bearer ${creds.access_token}` };

  // 2. Platform API accepts the token.
  const uiStatus = await fetchStatus(`${base}/oauth2/userinfo`, bearer);
  add('platform', uiStatus === 200 ? 'ok' : uiStatus === 0 ? 'unreachable' : 'unauthorized',
    uiStatus === 200 ? 'Platform API reachable and token accepted.'
      : uiStatus === 0 ? `Cannot reach ${base}.`
        : `Platform rejected the token (HTTP ${uiStatus}).`,
    uiStatus === 200 ? null
      : uiStatus === 0 ? 'Check network/VPN and the domain, then rerun.'
        : 'Run /nodge-connect to sign in again.');

  // 3. Platform MCP surface accepts the token. (The MCP OAuth your agent
  // client manages is a separate token; if this check is ok but MCP tools
  // still error, the client's MCP worker is stale — restart the session.)
  const mcpStatus = await fetchStatus(`${base}/api/mcp/tools`, bearer);
  add('mcp_surface', mcpStatus === 200 ? 'ok' : 'failed',
    mcpStatus === 200 ? 'Platform MCP endpoint reachable for this account.'
      : `MCP endpoint returned HTTP ${mcpStatus}.`,
    mcpStatus === 200 ? null : 'If MCP tools error in-session despite this, restart the agent session (stale MCP worker).');

  // 4. Project mapping for the current directory.
  const remote = git(['remote', 'get-url', 'origin']);
  const m = remote && remote.match(/^https?:\/\/(?:[^@/]+@)?([^/:]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m || m[1] !== `git.${creds.domain}`) {
    add('project', 'skipped', `Current directory is not a git.${creds.domain} checkout — project/git checks skipped.`);
    return report();
  }
  const [, host, org, repo] = m;
  const resolveStatus = await fetchStatus(
    `${base}/api/internal/resolve-project?repo=${encodeURIComponent(`${org}/${repo}`)}`, bearer);
  add('project', resolveStatus === 200 ? 'ok' : 'missing',
    resolveStatus === 200 ? `${org}/${repo} maps to a Nodge project.`
      : `No Nodge project found for ${org}/${repo} (HTTP ${resolveStatus}).`,
    resolveStatus === 200 ? null : 'Check you are in the right repo, or create the project on the platform first.');

  // 5. Git credential helper wired for this host. Matches both the plugin's
  // legacy helper (git-credential.mjs) and the CLI's (`nodge.mjs git-credential`)
  // that /nodge-connect delegates to.
  const helpers = git(['config', '--global', '--get-all', `credential.https://${host}.helper`]) || '';
  const wired = helpers.includes('git-credential');
  add('git_helper', wired ? 'ok' : 'missing',
    wired ? `Nodge credential helper configured for ${host}.`
      : `No Nodge credential helper for ${host}.`,
    wired ? null : 'Run /nodge-connect — it configures git auth for the platform host.');

  // 6. Actual repo access (read; exercises the full auth chain incl. git-gate).
  const lsRemote = git(['ls-remote', '--heads', 'origin'], { timeout: 30_000 });
  add('git_access', lsRemote !== null ? 'ok' : 'failed',
    lsRemote !== null ? 'Repo is reachable with the configured git auth.'
      : 'git ls-remote failed — git auth to the platform host is not working.',
    lsRemote !== null ? null : 'Run /nodge-connect to refresh sign-in and git helper, then retry.');

  report();
}

function report() {
  const firstBlocked = checks.find(c => !['ok', 'skipped'].includes(c.status));
  const overall = firstBlocked ? 'blocked' : 'ok';
  const nextAction = firstBlocked ? firstBlocked.next_action || firstBlocked.message : null;

  if (asJson) {
    console.log(JSON.stringify({ overall, checks, next_action: nextAction }, null, 2));
    return;
  }
  for (const c of checks) {
    const mark = c.status === 'ok' ? 'OK  ' : c.status === 'skipped' ? 'SKIP' : 'FAIL';
    console.log(`${mark}  ${c.name.padEnd(12)} ${c.message}`);
  }
  console.log(overall === 'ok'
    ? '\nAll checks passed.'
    : `\nNext action: ${nextAction}`);
}

main().catch(err => {
  console.error(`doctor failed: ${err.message}`);
  process.exit(1);
});
