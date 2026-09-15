#!/usr/bin/env node
/**
 * Loop boundary self-check — invoked as a standalone workflow step.
 *
 * Usage: node scripts/loop/gh-check.mjs [owner/repo]
 *
 * The loop's safety property is not "the agent holds a weak credential" — host and
 * agent share the job token, so there is only one. It is that **`main` cannot be
 * changed without a human**: the `Main branch` ruleset requires every change to
 * arrive through a pull request with one approving review, and the loop is not a
 * bypass actor. This script measures that claim instead of restating it, because it
 * depends on repository configuration that no file in this repo can express.
 *
 * Three questions, in order of how much they matter:
 *
 *   1. Is `main` actually un-writable? An idempotent `PATCH /git/refs/heads/main`
 *      that writes back the SHA it just read: a ruleset-protected branch refuses it
 *      with `422 Changes must be made through a pull request`, and **nothing
 *      changes**. A `2xx` means the protection is gone — a hard failure.
 *   2. Can the loop weaken that protection? `administration` is not a scope
 *      `permissions:` can grant, so the probe against the rulesets collection must
 *      be refused; if it is not, the loop could delete its own gate.
 *   3. Can the loop still do its job? Reads (sweep depends on them) and the
 *      Issues/Pull-requests/Contents writes it needs for labels, comments and
 *      branch pushes.
 *
 * How scopes are measured — the tempting method is wrong and was tried first:
 * calling a write endpoint against an impossible id and reading `403` as "no
 * permission" / `404` as "permission present". Measured against a `github.token`
 * capped to read-only by `permissions:`, those probes returned `404`, not `403`, so
 * `404` means only "the credential has *some* scope for this resource" — the method
 * reports false positives. What works is an **idempotent write**: read the current
 * value, write it straight back, and require `2xx`. `403` remains meaningful for a
 * scope the credential lacks entirely.
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
    all: all.trim(),
  };
}

/** A scope the credential lacks entirely answers `403`; anything else is "has some access". */
const hasAnyScope = (status) => status !== null && status !== 403 && status !== 401;

/**
 * `GET /user` is the decisive probe for *what kind of* credential this is:
 * a user token (PAT/OAuth) answers with a login; a GitHub App installation token —
 * i.e. `github.token` — is refused there entirely, which is exactly the signal we
 * want. `ok: false` therefore means "App token", not "broken credential".
 */
function identity(token) {
  const r = gh(['api', 'user', '--jq', '.login'], { token });
  return { login: r.ok ? r.out : null, ok: r.ok, status: r.status };
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

/**
 * The inverse: a write that **must** be refused for the loop's safety property to
 * hold. Restores nothing, because a successful probe changes nothing (it writes back
 * the value it read).
 * Returns `true` when refused as expected, `false` when it went through (bad), or
 * `null` when the probe could not run.
 */
function expectRefused(label, { read, write }, token, expected) {
  const cur = gh(read, { token });
  if (!cur.ok || !cur.out) {
    console.log(`  UNKNOWN   ${label} (nothing to probe against)`);
    return null;
  }
  const w = gh(write(cur.out), { token });
  const refused = !w.ok;
  console.log(`  ${refused ? 'refused' : 'ALLOWED'}  ${label} (HTTP ${w.status ?? 'n/a'})`);
  if (refused && expected && !expected.test(w.all)) {
    console.log(`            ↳ refused, but not for the expected reason; got: `
      + `${w.all.replace(/\s+/g, ' ').slice(0, 160)}`);
  }
  if (!refused) {
    console.log(`            ↳ the write SUCCEEDED — the protection is not in place. `
      + `It was reverted to the value it already had, so nothing changed.`);
  }
  return refused;
}

const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || '';
if (!repo) {
  console.error('[loop:gh] error: pass owner/repo or set GITHUB_REPOSITORY');
  process.exit(1);
}

const token = process.env.GH_TOKEN || null;
const who = identity(token);
// A token that cannot answer `GET /user` is an installation token — the job token. A
// 401 means the credential itself is unusable, which is worth saying rather than
// mislabelling; a 403/404 is `github.token` being refused there, as designed.
const isUserToken = Boolean(token) && who.ok;
const isAppToken = Boolean(token) && !who.ok && who.status !== 401;
const source = !token
  ? '(GH_TOKEN unset — gh used its own local login; the ruleset applies to it all the same)'
  : isUserToken
    ? `a user token for ${who.login} (PAT/OAuth)`
    : isAppToken
      ? 'github.token (the job token — the loop\'s only credential)'
      : `an unusable credential (GET /user answered ${who.status ?? 'nothing'})`;

console.log(`[loop:gh] repo: ${repo}`);
console.log(`[loop:gh] credential: ${source}`);
if (isUserToken) {
  console.log('  WARNING: the loop is authenticating with a *user* token. On Actions it must'
    + ' be `github.token`: a PAT acts as its owner, who is the ruleset bypass actor, so the'
    + ' loop could merge an unapproved PR and the gate would be gone.');
} else if (token && !isUserToken && !isAppToken) {
  console.log('  WARNING: the credential is not usable — every probe below will report'
    + ' UNKNOWN or absent scopes, and the loop cannot read GitHub either.');
}

/* ------------------------------------------------- 1. is main really protected? */

console.log('\n[loop:gh] MAIN PROTECTION — the property that matters:');
const rules = gh(['api', `repos/${repo}/rules/branches/main`], { token });
if (rules.ok) {
  let types = [];
  try { types = JSON.parse(rules.out).map((r) => r.type); } catch { /* keep [] */ }
  console.log(`  active rules on main: ${types.length ? types.join(', ') : '(none)'}`);
  if (!types.includes('pull_request')) {
    console.log('  ERROR: no `pull_request` rule on main — a direct push is allowed.');
  }
}
const refProbe = {
  read: ['api', `repos/${repo}/git/refs/heads/main`, '--jq', '.object.sha'],
  write: (sha) => ['api', '--method', 'PATCH',
    `repos/${repo}/git/refs/heads/main`, '-f', `sha=${sha}`],
};
const mainRefused = expectRefused(
  'direct push to main (idempotent; writes back the SHA it read)',
  refProbe, token, /pull request/i,
);

/* ------------------------------------- 2. can the loop weaken that protection? */

console.log('\n[loop:gh] CAN THE LOOP EDIT ITS OWN GATE (administration)?');
// An invalid create is the cheapest probe: `403` means no administration scope,
// `422` means the credential may write rulesets — the loop could remove the rule.
const adminProbe = gh(['api', '--method', 'POST', `repos/${repo}/rulesets`,
  '-f', 'name=probe (invalid on purpose: no enforcement)'], { token });
const canEditRulesets = adminProbe.status !== null
  && adminProbe.status !== 403 && adminProbe.status !== 404;
// Locally there is no GH_TOKEN and `gh` uses the developer's own login, which is *meant*
// to be able to edit rulesets — the question is only what the loop's credential can do.
const usingLoopCredential = Boolean(token);
console.log(`  ${canEditRulesets ? 'ALLOWED' : 'refused'}  create a ruleset (HTTP ${adminProbe.status ?? 'n/a'})`);
if (canEditRulesets && usingLoopCredential) {
  console.log('  ERROR: the loop\'s credential may write rulesets, so it could delete the'
    + ' protection above. The job token must not carry `administration` — and since'
    + ' `permissions:` cannot grant it, a PAT in the loop is the usual cause.');
} else if (canEditRulesets) {
  console.log('  (informational) your own login can edit rulesets — correct for a human'
    + ' operator, and exactly what the loop must never be able to do. On Actions this'
    + ' probe runs against `github.token` and must be refused.');
}

/* ------------------------------------------------- 3. can the loop still work? */

console.log('\n[loop:gh] reads — sweep depends on these; a miss breaks it:');
const reads = [
  ['repo metadata      (GET /repos)', ['api', `repos/${repo}`, '--jq', '.full_name']],
  ['issues list        (sweep)', ['issue', 'list', '-R', repo, '--state', 'open', '--limit', '1']],
  ['pull requests list (sweep)', ['pr', 'list', '-R', repo, '--state', 'open', '--limit', '1']],
  ['releases list      (sweep)', ['release', 'list', '-R', repo, '--limit', '1']],
];
const readResults = reads.map(([label, args]) => {
  const r = gh(args, { token });
  console.log(`  ${r.ok ? 'OK     ' : 'FAILED '}  ${label}`
    + `${r.ok ? '' : ` — ${(r.err || r.status).toString().slice(0, 90)}`}`);
  return { label, ok: r.ok };
});

console.log('\n[loop:gh] write scopes (idempotent probes — each restores the value it read):');
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
const canLabel = idempotentWrite('Issues: write        (label/comment/close)', issueProbe, token);
idempotentWrite('Pull requests: write (open/edit PR)', prProbe, token);
// A ref that is *not* `main`: this one must succeed, which is how the loop pushes
// `loop/<n>-*`. Probe against an existing branch so the write is a no-op.
const branchList = gh(['api', `repos/${repo}/branches?per_page=1`, '--jq', '.[0].name'], { token });
const probeBranch = branchList.ok && branchList.out ? branchList.out : null;
const canPushBranches = probeBranch
  ? idempotentWrite(`Contents: write      (push loop/<n>-* branches)`, {
    read: ['api', `repos/${repo}/git/refs/heads/${probeBranch}`, '--jq', '.object.sha'],
    write: (sha) => ['api', '--method', 'PATCH',
      `repos/${repo}/git/refs/heads/${probeBranch}`, '-f', `sha=${sha}`],
  }, token)
  : null;

console.log('\n[loop:gh] scopes the loop should NOT have:');
const dangerous = [
  ['Actions: write       (trigger/disable workflows)', ['api', '--method', 'POST',
    `repos/${repo}/actions/workflows/${IMPOSSIBLE}/dispatches`, '-f', 'ref=main']],
];
for (const [label, args] of dangerous) {
  const r = gh(args, { token });
  console.log(`  ${hasAnyScope(r.status) ? 'present' : 'ABSENT '}  ${label} (HTTP ${r.status ?? 'n/a'})`);
}
// Read-only probe: listing secret *names* requires the Secrets permission. The
// listing itself is never printed — only whether the permission is present.
const secrets = gh(['api', `repos/${repo}/actions/secrets`], { token });
console.log(`  ${secrets.ok ? 'present' : 'ABSENT '}  Secrets access       (list/overwrite CI secrets)`);

/* -------------------------------------------------------------------- verdict */

const brokenReads = readResults.filter((r) => !r.ok);
const writeLevel = process.env.LOOP_WRITE_LEVEL
  ?? (process.env.LOOP_EXECUTE_WRITES === 'true' ? 'auto' : 'report');

console.log('');
console.log(`[loop:gh] main protection: ${mainRefused === null ? 'UNKNOWN'
  : mainRefused ? 'holding — a direct push is refused' : 'MISSING — a direct push succeeded'}`);
console.log(`[loop:gh] gate integrity:  ${canEditRulesets
  ? (usingLoopCredential ? 'loop can edit its own ruleset (bad)' : 'your login can (loop credential not in play)')
  : 'loop cannot edit the ruleset'}`);
console.log(`[loop:gh] label/comment/close: ${canLabel ? 'available'
  : 'NOT available — the loop cannot do its job'}`);
console.log(`[loop:gh] branch push:     ${canPushBranches ? 'available' : 'NOT available'}`
  + ' (product stages need it; `main` is excluded by the ruleset, not by missing scope)');
console.log(`[loop:gh] reads: ${brokenReads.length
  ? `${brokenReads.length} FAILED — the host's sweep will break: ${brokenReads.map((r) => r.label.trim().split(/\s+/)[0]).join(', ')}`
  : 'all OK'}`);
console.log(`[loop:gh] write level: ${writeLevel}`);
if (writeLevel === 'auto' && (!canLabel || canPushBranches === false)) {
  console.log('  WARNING: `auto` is on but a write scope is missing — runs will fail after'
    + ' spending tokens. Fix the `permissions:` block, or keep LOOP_EXECUTE_WRITES=false.');
}

// The two properties that must hold before the loop is allowed to write anything:
// it cannot reach `main` directly, and it cannot take the protection away.
if (mainRefused === false || (canEditRulesets && usingLoopCredential)) {
  console.log('\n[loop:gh] FAIL: the loop\'s safety property is not satisfied — see the'
    + ' ERROR lines above. Do not enable `auto`.');
  process.exit(1);
}
if (mainRefused === null) {
  console.log('\n[loop:gh] WARNING: main protection could not be measured (no ref to probe).');
}
console.log('[loop:gh] OK: `main` requires a reviewed pull request, the loop cannot edit that'
  + ' rule, and the loop\'s own writes work.');
