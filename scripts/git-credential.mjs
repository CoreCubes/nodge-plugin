// Git credential helper for Nodge-hosted repos (git.<domain>).
//
// /nodge-connect registers this as the sole helper for the platform's git
// host. On `get`, it answers with the platform username and a fresh 1h
// platform JWT as the password; the server-side git gate
// (platform/routes/internal/git-gate.js) validates the JWT and swaps it for
// real Forgejo credentials. Because nodge-auth refreshes the JWT via the 30d
// refresh token on every invocation, pushes keep working long after the
// initial sign-in — no OS credential manager involved.
//
// `store` and `erase` are deliberate no-ops: the only persisted state is
// ~/.nodge/credentials.json, owned by nodge-auth.

import { getFreshCreds } from './nodge-auth.mjs';

// Must match usernameFromEmail in platform/lib/identity/users.js.
function usernameFromEmail(email) {
  return email.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 40).replace(/^-|-$/g, '_');
}

function readStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

async function main() {
  if (process.argv[2] !== 'get') return;

  const attrs = {};
  for (const line of (await readStdin()).split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) attrs[line.slice(0, eq)] = line.slice(eq + 1);
  }

  const creds = await getFreshCreds();
  // Not connected or a different host: stay silent so git can fall back to
  // prompting instead of failing with a bogus credential.
  if (!creds || attrs.protocol !== 'https' || attrs.host !== `git.${creds.domain}`) return;

  process.stdout.write(`username=${creds.email ? usernameFromEmail(creds.email) : 'nodge'}\n`);
  process.stdout.write(`password=${creds.access_token}\n`);
}

main().catch(() => {}).finally(() => process.exit(0));
