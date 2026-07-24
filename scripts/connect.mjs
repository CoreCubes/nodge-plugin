// /nodge-connect — connect this machine to the Nodge platform.
//
// Bootstraps the Nodge CLI (platform/cli/) when it isn't installed yet, then
// delegates sign-in to `nodge connect`. The CLI owns the one auth + git
// credential implementation (OAuth client `nodge-cli`, ~/.nodge/credentials.json,
// git helper for git.<domain>); this script deliberately has no OAuth flow of
// its own. Hook scripts keep working because nodge-auth.mjs refreshes with
// whatever client_id the credentials file records.
//
// Usage: node connect.mjs [domain]
// Domain resolution: arg → NODGE_DOMAIN env → ~/.nodge/install-meta.json →
// existing credentials → nodge.ai default.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCreds, getFreshCreds } from './nodge-auth.mjs';

const DEFAULT_DOMAIN = 'nodge.ai';
const NODGE_DIR = path.join(os.homedir(), '.nodge');
const CLI_MJS = path.join(NODGE_DIR, 'cli', 'bin', 'nodge.mjs');

function resolveDomain() {
  const arg = (process.argv[2] || '').trim();
  if (arg) return arg;
  const env = (process.env.NODGE_DOMAIN || '').trim();
  if (env) return env;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(NODGE_DIR, 'install-meta.json'), 'utf8'));
    if (meta.domain) return meta.domain;
  } catch { /* no install-meta yet */ }
  const creds = loadCreds();
  if (creds && creds.domain) return creds.domain;
  return DEFAULT_DOMAIN;
}

async function installCli(domain) {
  const isWin = process.platform === 'win32';
  const installerUrl = `https://platform.${domain}/cli/${isWin ? 'install.ps1' : 'install'}`;
  console.log(`[1/2] Nodge CLI not found — installing from ${installerUrl}`);

  let script;
  try {
    const resp = await fetch(installerUrl, { signal: AbortSignal.timeout(60_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    script = await resp.text();
  } catch (err) {
    console.error(`Could not download the installer (${err.message}).`);
    printManualFallback(domain, isWin);
    process.exit(1);
  }

  // powershell -File requires a .ps1 extension; sh doesn't care.
  const tmp = path.join(os.tmpdir(), `nodge-install-${process.pid}${isWin ? '.ps1' : '.sh'}`);
  fs.writeFileSync(tmp, script, { mode: 0o700 });

  // The installer checks for `node` on PATH; guarantee it finds the same
  // runtime executing this script (agent hosts don't always export it).
  const env = {
    ...process.env,
    PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || ''),
  };
  const result = isWin
    ? spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
        { stdio: 'inherit', env })
    : spawnSync('sh', [tmp], { stdio: 'inherit', env });
  try { fs.unlinkSync(tmp); } catch { /* temp cleanup only */ }

  if (result.error || result.status !== 0) {
    console.error(`Installer failed${result.error ? ` (${result.error.message})` : ` (exit ${result.status})`}.`);
    printManualFallback(domain, isWin);
    process.exit(1);
  }
  if (!fs.existsSync(CLI_MJS)) {
    console.error('Installer finished but the CLI is missing at ~/.nodge/cli — run /nodge-doctor.');
    process.exit(1);
  }
}

function printManualFallback(domain, isWin) {
  console.error('You can install the Nodge CLI manually, then re-run /nodge-connect:');
  console.error(isWin
    ? `  iwr -useb https://platform.${domain}/cli/install.ps1 | iex`
    : `  curl -fsSL https://platform.${domain}/cli/install | sh`);
}

async function main() {
  const domain = resolveDomain();

  // Already signed in to this domain with a working token? Nothing to do.
  // An explicitly named different domain falls through to a full connect.
  const fresh = await getFreshCreds().catch(() => null);
  if (fresh && fresh.domain === domain) {
    console.log(`Already connected to ${domain}${fresh.email ? ` as ${fresh.email}` : ''}. Run /nodge-doctor to verify the full chain.`);
    return;
  }

  if (fs.existsSync(CLI_MJS)) {
    console.log('[1/2] Nodge CLI found at ~/.nodge/cli');
  } else {
    await installCli(domain);
  }

  console.log(`[2/2] Signing in to ${domain} (browser opens; the CLI prints its own progress)`);
  const child = spawnSync(process.execPath, [CLI_MJS, 'connect', domain], { stdio: 'inherit' });
  if (child.error) {
    console.error(`Could not run the Nodge CLI (${child.error.message}). Run /nodge-doctor.`);
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

main().catch(err => {
  console.error(`Connect failed: ${err.message}`);
  process.exit(1);
});
