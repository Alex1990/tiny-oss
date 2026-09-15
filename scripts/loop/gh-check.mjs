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

// `PATCH /git/refs/{ref}` is in the Contents write set, and setting a ref to the
// SHA it already has is a no-op — so a 2xx means real write ability and nothing
// changes.
//
// This is the only sound way to measure Contents. The repository's
// `.permissions` object is NOT a token scope report: it describes the
// *authenticated user's* role, so it answers `push: true` for any token
// belonging to an admin, no matter how narrowly the token was scoped. Reading it
// here reported a Contents Read-only PAT as write-capable.
const defaultBranch = gh(['api', `repos/${repo}`, '--jq', '.default_branch'],
  { token: hostToken }).out || 'main';
const refProbe = {
  read: ['api', `repos/${repo}/git/refs/heads/${defaultBranch}`, '--jq', '.object.sha'],
  write: (sha) => ['api', '--method', 'PATCH',
    `repos/${repo}/git/refs/heads/${defaultBranch}`, '-f', `sha=${sha}`],
};
const canPush = idempotentWrite(
  `Contents: write      (MERGE + push + release)`, refProbe, hostToken,
);
const hostPerm = gh(['api', `repos/${repo}`, '--jq', '.permissions'], { token: hostToken });
if (hostPerm.ok) {
  console.log(`  (info) repo .permissions = ${hostPerm.out.replace(/\s+/g, ' ')}`
    + ' — the *user\'s* role, not this token\'s scopes; do not read it as a scope report');
}
// `canPush` above is the host's ability to push `loop/<n>-*` **and** to merge: one
// scope covers both, which is exactly why it must not exist on any credential the
// agent can reach. The agent check at the end of this script confirms it does not.

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
const writeLevel = process.env.LOOP_WRITE_LEVEL
  ?? (process.env.LOOP_EXECUTE_WRITES === 'true' ? 'auto' : 'report');
console.log('');
if (canPush) {
  console.log('[loop:gh] host credential holds Contents:write — branch pushes and PR creation are'
    + ' possible. This is required for L2c, and it is also the merge permission, which is why'
    + ' the agent is never given this credential (see the check at the end). One fine-grained'
    + ' PAT with Contents + Issues + Pull requests write, scoped to this repository, is the'
    + ' whole configuration.');
} else if (canPush === false) {
  console.log('[loop:gh] host credential holds no Contents:write — the loop cannot push a branch,'
    + ' so no product stage can ever reach `pr-opened`. Keep LOOP_EXECUTE_WRITES=false until'
    + ' LOOP_GH_TOKEN carries Contents: Read and write on this repository.');
}
console.log(`[loop:gh] label/comment/close: ${canLabel ? 'available' : 'NOT available — the loop cannot do its job'}`);
console.log(`[loop:gh] reads: ${brokenReads.length
  ? `${brokenReads.length} FAILED — the host's sweep will break: ${brokenReads.map((r) => r.label.trim().split(/\s+/)[0]).join(', ')}`
  : 'all OK'}`);
console.log(`[loop:gh] write level (this configuration): ${writeLevel}`);
if (writeLevel === 'auto' && !canLabel) {
  console.log('  WARNING: `auto` is switched on but the credential cannot label/comment — the loop'
    + ' will run, propose, and silently fail to write. Configure LOOP_GH_TOKEN first.');
}
if (writeLevel === 'auto' && canPush === false) {
  console.log('  WARNING: `auto` is switched on but the host cannot push — every product stage will'
    + ' fail at the push and land in the human inbox. Either grant LOOP_GH_TOKEN Contents:'
    + ' Read and write, or keep LOOP_EXECUTE_WRITES=false.');
}

// What the agent actually holds, after `agentEnv` has built the child environment. The
// agent is read-only in **every** mode, so this check is not conditional on the write
// level: the loop's writes are the host's job, and a credential that could write here
// would be a configuration error, not a mode.
//
// Identity cannot be read from `GET /user` for `github.token`: it is a GitHub App
// installation token and is refused there entirely, which is why these checks combine
// two signals that *are* observable — whether the credential can read the repository,
// and whether a write is refused.
console.log('\n[loop:gh] credential handed to the agent (agentEnv: read-only in every mode):');
if (!agentToken) {
  console.log('  (GH_READ_TOKEN is not set, so agentEnv leaves the child without GH_TOKEN — `gh`'
    + ' there would fall back to any local login. On Actions this variable is always set.)');
} else {
  const canRead = gh(['api', `repos/${repo}`, '--jq', '.full_name'], { token: agentToken });
  const asUser = gh(['api', 'user', '--jq', '.login'], { token: agentToken });
  console.log(`  can read the repo:          ${canRead.ok ? 'yes' : `NO — the agent cannot read GitHub (${canRead.status})`}`);
  console.log(`  acts as a user:             ${asUser.ok ? `yes (${asUser.out}) — a PAT or user token` : 'no — a GitHub App token, i.e. github.token'}`);
  const agentWrite = idempotentWrite('Issues: write', issueProbe, agentToken);
  const agentPush = idempotentWrite('Contents: write', refProbe, agentToken);

  if (!canRead.ok) {
    console.log('  WARNING: the agent cannot read GitHub, so triage/sweep will find nothing.');
  } else if (agentWrite || agentPush) {
    console.log('  WARNING: the agent CAN WRITE. It should hold `github.token` capped at read by'
      + " the workflow's `permissions:` block, so check that block — and check that GH_READ_TOKEN"
      + ' is `github.token`, not a PAT.');
  } else {
    console.log('  OK: the agent can read GitHub and cannot write anything (no Issues, no Contents)'
      + ' — so it cannot label, comment, push or merge, whatever its prompt says. Every write is'
      + ' the host\'s, executed from the agent\'s result file.');
  }
}
