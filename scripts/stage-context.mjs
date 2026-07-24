// Commit-context capture hook. Claude Code invokes this on TodoWrite /
// AskUserQuestion / ExitPlanMode (PostToolUse) and on Stop, passing the hook
// event as JSON on stdin. We forward one raw event per fire to the platform's
// staging endpoint; ALL keep/skip/fold rules live server-side
// (platform/lib/projects/commit-context.js), so this script stays dumb.
//
// Never blocks the turn: every failure path logs to stderr and exits 0.

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getAuth, loadProjectCache, saveProjectCache } from './nodge-auth.mjs';

// Claude Code hook types, plus `codex-stop` — the same script wired into
// Codex's Stop hook (~/.codex/hooks.json, see ../codex/hooks.json). Codex
// hands the final message directly in the payload (no transcript tail) and
// has no todo rhythm, so it maps to the server's ungated `summary` type.
const HOOK_TYPES = new Set(['todo', 'question', 'plan', 'stop', 'codex-stop']);
const SUMMARY_MAX_CHARS = 64 * 1024; // server caps payloads at 256 KB; stay well under

async function main() {
  const hookType = process.argv[2];
  if (!HOOK_TYPES.has(hookType)) return;

  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  const cwd = input.cwd || process.cwd();

  const auth = await getAuth();
  if (!auth) return; // not connected — silent no-op

  const repo = resolveRepo(cwd, auth.domain);
  if (!repo) return; // not a Nodge-hosted repo

  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!branch || branch === 'HEAD') return; // detached HEAD — nothing to key on

  const payload = buildPayload(hookType, input);
  if (!payload) return;

  const projectId = await resolveProjectId(auth, repo);
  if (!projectId) return;

  const serverHookType = hookType === 'codex-stop' ? 'summary' : hookType;

  const resp = await fetch(`${auth.baseUrl}/api/internal/session-context`, {
    method: 'POST',
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: projectId,
      branch,
      hook_type: serverHookType,
      payload,
      chat_session_id: input.session_id || null,
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!resp.ok) {
    console.error(`[nodge] stage-context ${hookType} → ${resp.status}`);
  }
}

function git(cwd, args) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

// Parse the origin remote into { host, org, repo } and require it to be the
// connected platform's git host (git.<domain>). Sidecar callers (agent token,
// no domain) skip the host check — their checkout IS the project repo.
function resolveRepo(cwd, domain) {
  const remote = git(cwd, ['remote', 'get-url', 'origin']);
  if (!remote) return null;
  const m = remote.match(/^(?:https?:\/\/(?:[^@/]+@)?|git@|ssh:\/\/(?:[^@/]+@)?)([^/:]+)[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const [, host, org, repo] = m;
  if (domain && host !== `git.${domain}`) return null;
  return { host, org, repo };
}

function buildPayload(hookType, input) {
  switch (hookType) {
    case 'todo':
      return input.tool_input ? { todos: input.tool_input.todos ?? input.tool_input } : null;
    case 'question':
      // The question AND the user's answer — the answers are the decisions.
      return input.tool_input ? { question: input.tool_input, response: input.tool_response ?? null } : null;
    case 'plan':
      // Depending on the Claude Code version the approved plan text arrives in
      // tool_input or tool_response — forward both, the server keeps the blob.
      return { plan: input.tool_input ?? null, response: input.tool_response ?? null };
    case 'stop': {
      const summary = lastAssistantText(input.transcript_path);
      return summary ? { summary } : null;
    }
    case 'codex-stop': {
      const text = typeof input.last_assistant_message === 'string' ? input.last_assistant_message.trim() : '';
      return text ? { summary: text.slice(0, SUMMARY_MAX_CHARS) } : null;
    }
    default:
      return null;
  }
}

// Tail the transcript JSONL for the last assistant message's text blocks.
function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return null;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n');
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry.type !== 'assistant' || !entry.message || !Array.isArray(entry.message.content)) continue;
    const text = entry.message.content
      .filter(b => b.type === 'text' && typeof b.text === 'string')
      .map(b => b.text)
      .join('\n')
      .trim();
    if (text) return text.slice(0, SUMMARY_MAX_CHARS);
  }
  return null;
}

// org/repo → project UUID, cached in ~/.nodge/project-cache.json. A 404 is not
// cached (the project may be created moments later).
async function resolveProjectId(auth, repo) {
  const key = `${repo.host}/${repo.org}/${repo.repo}`;
  const cache = loadProjectCache();
  if (cache[key]) return cache[key];

  const resp = await fetch(
    `${auth.baseUrl}/api/internal/resolve-project?repo=${encodeURIComponent(`${repo.org}/${repo.repo}`)}`,
    { headers: auth.headers, signal: AbortSignal.timeout(8_000) }
  );
  if (!resp.ok) return null;
  const data = await resp.json();
  if (!data.project_id) return null;

  cache[key] = data.project_id;
  saveProjectCache(cache);
  return data.project_id;
}

main().catch(err => console.error('[nodge] stage-context failed:', err.message)).finally(() => process.exit(0));
