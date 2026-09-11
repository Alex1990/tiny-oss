#!/usr/bin/env node
/**
 * GitHub credential self-check — invoked as a standalone workflow step.
 *
 * Usage: node scripts/loop/gh-check.mjs [owner/repo]
 *
 * Why this exists: `GH_TOKEN` is `secrets.LOOP_GH_TOKEN || github.token`. The
 * moment a real PAT is configured it replaces the job token for **every** `gh`
 * call, including the read-only ones sweep depends on. A PAT that is narrower
 * than the job token therefore breaks reads silently, and one that is broader
 * silently widens what the loop can do. Neither is visible from the workflow
 * file, so it has to be measured.
 *
 * How permissions are measured — two methods, because the obvious one is wrong:
 *
 *   1. GitHub's own `permissions` object for the credential. No inference.
 *   2. **Idempotent writes** for scopes the object does not describe (Issues and
 *      Pull requests). The probe reads the current value and writes it straight
 *      back, so nothing changes — but a `2xx` means the write really executed,
 *      which only happens with the write scope.
 *
 * The tempting method — call a write endpoint against an impossible id and read
 * `403` as "no permission", `404` as "permission present" — does **not** work.
 * Measured against a `github.token` capped to read-only by `permissions:`, the
 * write probes returned `404`, not `403`. So `404` means only "the credential
 * has *some* scope for this resource", read or write, and the method reports
 * false positives. `403` remains meaningful for a scope the token lacks
 * entirely, which is why the Actions and Secrets checks still use it.
 *
 * The token itself is never printed. Only the login it authenticates as.
 */

import { spawnSync } from 'node:child_process';

const IMPOSSIBLE = '999999999'; // beyond any real issue/PR number here
const SEP = '\u0001'; // unlikely in a real title

/** Run `gh`, returning the HTTP status it saw and whether it succeeded. */
function gh(args, { token = null } = {}) {
  const env = { ...process.env, GH_PAGER: '', NO_COLOR: '1' };
  if (token) env.GH_TOKEN = token;
  const r = spawnSync('gh', args, { encoding: 'utf8', env });
  const all = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = /HTTP (\d{3})/.exec(all);
  return {
    ok: r.status === 0,
    status: m ? Number(m[1]) : (r.status === 0 ? 200 : null),
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  };
}

/** A scope the credential lacks entirely answers `403`; anything else is "has some access". */
const hasAnyScope = (status) => status !== null && status !== 403 && status !== 401;

/** Identity is the decisive fact for a credential we did not choose. */
function identity(token) {
  const r = gh(['api', 'user', '--jq', '.login'], { token });
  return r.ok ? r.out : null;
}

/**
 * Write nothing, change nothing — but require the write scope to succeed.
 * Returns `true` (2xx), `false` (refused), or `null` (no target to probe with).
 */
function idempotentWrite(label, { read, write }, token) {
  const cur = gh(read, { token });
  if (!cur.ok || !cur.out) {
    console.log(`  UNKNOWN   ${label} (nothing to probe against)`);
    return null;
  }
  const w = gh(write(cur.out), { token });
  console.log(`  ${w.ok ? 'present' : 'ABSENT '}  ${label} (HTTP ${w.status ?? 'n/a'})`);
  return w.ok;
}

const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || '';
if (!repo) {
  console.error('[loop:gh] error: pass owner/repo or set GITHUB_REPOSITORY');
  process.exit(1);
}

const hostToken = process.env.GH_TOKEN || null;
const agentToken = process.env.GH_READ_TOKEN || null;

console.log(`[loop:gh] repo: ${repo}`);

const hostWho = identity(hostToken);
if (!hostWho) {
  // A token that cannot even identify itself is the one hard failure: every
  // later `gh` call in the job would fail too, so fail loudly and early.
  console.error('[loop:gh] error: GH_TOKEN cannot authenticate');
  process.exit(1);
}
const hostIsJob = hostWho === 'github-actions[bot]';
// Locally there is no GH_TOKEN — `gh` falls back to the developer's own login,
// so saying "github.token" there would be plainly wrong.
const hostSource = !hostToken
  ? '(GH_TOKEN unset — gh used its own local login)'
  : hostIsJob ? 'github.token (job token)' : 'LOOP_GH_TOKEN (a PAT, replacing the job token)';
console.log(`[loop:gh] host credential: ${hostSource} — authenticates as ${hostWho}`);

console.log('\n[loop:gh] reads — the host depends on these; a miss breaks sweep:');
// sweep lists open issues/PRs and calls `gh release list`; repo metadata is the
// cheapest liveness check.
const reads = [
  ['repo metadata      (GET /repos)', ['api', `repos/${repo}`, '--jq', '.full_name']],
  ['issues list        (sweep)', ['issue', 'list', '-R', repo, '--state', 'open', '--limit', '1']],
  ['pull requests list (sweep)', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '1']],
  ['releases list      (sweep)', ['release', 'list', '-R', repo, '--limit', '1']],
];
const readResults = reads.map(([label, args]) => {
  const r = gh(args, { token: hostToken });
  console.log(`  ${r.ok ? 'OK     ' : 'FAILED '}  ${label}`
    + `${r.ok ? '' : ` — ${(r.err || r.status).toString().slice(0, 90)}`}`);
  return { label, ok: r.ok };
});

console.log('\n[loop:gh] host write scopes (idempotent probes — each restores the value it read):');
const issueProbe = {
  read: ['api', `repos/${repo}/issues?state=open&per_page=1`, '--jq', `.[0] | "\\(.number)${SEP}\\(.title)"`],
  write: (cur) => {
    const [n, title] = cur.split(SEP);
    return ['api', '--method', 'PATCH', `repos/${repo}/issues/${n}`, '-f', `title=${title}`];
  },
};
const prProbe = {
  read: ['api', `repos/${repo}/pulls?state=open&per_page=1`, '--jq', `.[0] | "\\(.number)${SEP}\\(.title)"`],
  write: (cur) => {
    const [n, title] = cur.split(SEP);
    return ['api', '--method', 'PATCH', `repos/${repo}/pulls/${n}`, '-f', `title=${title}`];
  },
};
const canLabel = idempotentWrite('Issues: write        (label/comment/close)', issueProbe, hostToken);
idempotentWrite('Pull requests: write (open/edit PR, reviews)', prProbe, hostToken);

// `permissions.push` is the repository-write flag, which on GitHub's model is
// exactly `Contents: write` — the scope that carries merging, branch pushes and
// `POST /releases` together. It is read from GitHub rather than probed.
const hostPerm = gh(['api', `repos/${repo}`, '--jq', '.permissions'], { token: hostToken });
let canPush = null;
if (hostPerm.ok && hostPerm.out) {
  try {
    canPush = JSON.parse(hostPerm.out).push === true;
  } catch { /* leave null */ }
  console.log(`  ${canPush ? 'present' : 'ABSENT '}  Contents: write      (MERGE + push + release)`);
} else {
  console.log('  UNKNOWN   Contents: write      (repo permissions unreadable)');
}

console.log('\n[loop:gh] scopes reached by a credential that lacks them entirely:');
const absent = [
  ['Actions: write       (trigger/disable workflows)', ['api', '--method', 'POST',
    `repos/${repo}/actions/workflows/${IMPOSSIBLE}/dispatches`, '-f', 'ref=main']],
];
for (const [label, args] of absent) {
  const r = gh(args, { token: hostToken });
  console.log(`  ${hasAnyScope(r.status) ? 'present' : 'ABSENT '}  ${label} (HTTP ${r.status ?? 'n/a'})`);
}
// Read-only probe: listing secret *names* requires the Secrets permission. The
// listing itself is never printed — only whether the permission is present.
const secrets = gh(['api', `repos/${repo}/actions/secrets`], { token: hostToken });
console.log(`  ${secrets.ok ? 'present' : 'ABSENT '}  Secrets access       (list/overwrite CI secrets)`);

const brokenReads = readResults.filter((r) => !r.ok);
console.log('');
if (canPush) {
  console.log('[loop:gh] WARNING: the host holds Contents:write. That single scope grants merging'
    + ' (PUT /pulls/{n}/merge), branch pushes and POST /releases — none of which the loop needs'
    + ' until L2. See "GitHub write credential" in scripts/loop/README.md. Recreate the PAT with:'
    + ' Issues Read and write, Pull requests Read and write, Contents Read-only, and Nothing for'
    + ' Actions/Secrets/Administration/Workflows.');
} else if (canPush === false) {
  console.log('[loop:gh] host holds no Contents:write — merging, branch pushes and releases are'
    + ' impossible for it.');
}
console.log(`[loop:gh] label/comment/close: ${canLabel ? 'available' : 'NOT available — the loop cannot do its job'}`);
console.log(`[loop:gh] reads: ${brokenReads.length
  ? `${brokenReads.length} FAILED — the host's sweep will break: ${brokenReads.map((r) => r.label.trim().split(/\s+/)[0]).join(', ')}`
  : 'all OK'}`);

// The credential the *agent* will hold. `runPi` swaps GH_TOKEN for GH_READ_TOKEN
// under the report boundary, so this decides whether the agent could write if it
// ignored its prompt.
//
// Identity cannot be read from `GET /user` here: `github.token` is a GitHub App
// installation token and is refused there entirely, which is why the check below
// combines two signals that *are* observable — whether the credential can read
// the repository at all, and whether a write is refused.
console.log('\n[loop:gh] credential handed to the agent under the report boundary:');
if (!agentToken) {
  console.log('  (GH_READ_TOKEN is not set — runPi would pass GH_TOKEN through unchanged,'
    + ' i.e. the agent inherits the host credential above.)');
} else {
  const canRead = gh(['api', `repos/${repo}`, '--jq', '.full_name'], { token: agentToken });
  const asUser = gh(['api', 'user', '--jq', '.login'], { token: agentToken });
  console.log(`  can read the repo:          ${canRead.ok ? 'yes' : `NO — the agent cannot read GitHub (${canRead.status})`}`);
  console.log(`  acts as a user:             ${asUser.ok ? `yes (${asUser.out}) — a PAT or user token` : 'no — a GitHub App token, i.e. github.token'}`);
  const agentWrite = idempotentWrite('Issues: write', issueProbe, agentToken);

  if (!canRead.ok) {
    console.log('  WARNING: the agent cannot read GitHub, so triage/sweep will find nothing.');
  } else if (asUser.ok) {
    console.log(`  WARNING: the agent holds a *user* token (${asUser.out}) — it inherits that`
      + " user's reach, so the report boundary is a prompt instruction only.");
  } else if (agentWrite) {
    console.log('  WARNING: the agent can write (github.token is not capped to read — check the'
      + " workflow's `permissions:` block).");
  } else {
    console.log('  OK: github.token, read-only by the workflow\'s `permissions:` block — the agent'
      + ' reaches GitHub read-only even if it ignores its prompt. The report boundary is a'
      + ' platform guarantee.');
  }
}
