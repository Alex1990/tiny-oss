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
 * silently hands the agent write access nobody chose. Neither is visible from
 * the workflow file, so it has to be measured.
 *
 * Permission probing without side effects: a write endpoint is called against a
 * resource number that cannot exist. `403` means the token lacks the scope;
 * `404`/`422` means the request passed the permission check and only failed on
 * the missing resource — i.e. the scope is present. Nothing is ever mutated,
 * because every probe targets an id far beyond this repository's range.
 *
 * The token itself is never printed. Only the login it authenticates as.
 */

import { spawnSync } from 'node:child_process';

const IMPOSSIBLE = '999999999'; // far beyond any real issue/PR number here

/** Run `gh`, returning the HTTP status it saw and whether it succeeded. */
function gh(args, { json = false } = {}) {
  const r = spawnSync('gh', json ? [...args, '--jq', '.'] : args, {
    encoding: 'utf8',
    env: { ...process.env, GH_PAGER: '', NO_COLOR: '1' },
  });
  const all = `${r.stdout || ''}\n${r.stderr || ''}`;
  const m = /HTTP (\d{3})/.exec(all);
  return {
    ok: r.status === 0,
    status: m ? Number(m[1]) : (r.status === 0 ? 200 : null),
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim(),
  };
}

/**
 * `403`/`401` = scope absent. Anything else means the permission check passed
 * and the request failed later (missing resource, bad body) — scope present.
 */
const hasScope = (status) => status !== null && status !== 403 && status !== 401;

function probe(label, args) {
  const r = gh(args);
  const present = hasScope(r.status);
  console.log(`  ${present ? 'present' : 'ABSENT '}  ${label}`
    + ` (HTTP ${r.status ?? 'n/a'})`);
  return { label, present, status: r.status, err: r.err };
}

const repo = process.argv[2] || process.env.GITHUB_REPOSITORY || '';
if (!repo) {
  console.error('[loop:gh] error: pass owner/repo or set GITHUB_REPOSITORY');
  process.exit(1);
}

console.log(`[loop:gh] repo: ${repo}`);

const who = gh(['api', 'user', '--jq', '.login']);
if (!who.ok) {
  // A token that cannot even identify itself is the one hard failure: every
  // later `gh` call in the job would fail too, so fail loudly and early.
  console.error(`[loop:gh] error: token cannot authenticate — ${who.err || who.status}`);
  process.exit(1);
}
console.log(`[loop:gh] token authenticates as: ${who.out}`);
const isJobToken = who.out === 'github-actions[bot]';
// Only claim which credential this is inside Actions: run locally, `gh` uses
// whatever the developer is logged in as, and naming LOOP_GH_TOKEN there would
// be plainly wrong.
if (process.env.GITHUB_ACTIONS) {
  console.log(`[loop:gh] credential: ${isJobToken
    ? 'github.token (job token — LOOP_GH_TOKEN is unset or empty)'
    : 'LOOP_GH_TOKEN (a PAT, replacing the job token for every gh call)'}`);
}

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
  const r = gh(args);
  console.log(`  ${r.ok ? 'OK     ' : 'FAILED '}  ${label}`
    + `${r.ok ? '' : ` — ${(r.err || r.status).toString().slice(0, 90)}`}`);
  return { label, ok: r.ok };
});

console.log('\n[loop:gh] writes — probes target an impossible number, nothing is changed:');
const writes = [
  ['Issues: write        (label/comment/close)', ['api', '--method', 'PATCH',
    `repos/${repo}/issues/${IMPOSSIBLE}`, '-f', 'state=open']],
  ['Pull requests: write (open/edit PR)', ['api', '--method', 'PATCH',
    `repos/${repo}/pulls/${IMPOSSIBLE}`, '-f', 'state=open']],
  ['Contents: write      (MERGE + push)', ['api', '--method', 'PUT',
    `repos/${repo}/pulls/${IMPOSSIBLE}/merge`]],
];
const results = writes.map(([label, args]) => probe(label, args));
const canMerge = results.find((r) => r.label.startsWith('Contents'))?.present ?? false;
const brokenReads = readResults.filter((r) => !r.ok);
const canLabel = results.find((r) => r.label.startsWith('Issues'))?.present ?? false;

console.log('');
if (canMerge) {
  console.log('[loop:gh] WARNING: the token holds Contents:write. That single scope grants'
    + ' merging (PUT /pulls/{n}/merge), branch pushes, and POST /releases — none of which'
    + ' the loop should have. See "GitHub write credential" in scripts/loop/README.md.');
  console.log('[loop:gh] Recreate the PAT with: Issues RW, Pull requests RW, Contents read.');
} else {
  console.log('[loop:gh] Contents:write absent — merging is impossible for this credential,'
    + ' which is the intended L2c property.');
}
console.log(`[loop:gh] label/comment/close: ${canLabel ? 'available' : 'NOT available — the loop cannot do its job'}`);
console.log(`[loop:gh] reads: ${brokenReads.length
  ? `${brokenReads.length} FAILED — the host's sweep will break: ${brokenReads.map((r) => r.label.trim().split(/\s+/)[0]).join(', ')}`
  : 'all OK'}`);
