#!/usr/bin/env node
/**
 * Session mining CLI — read the uploaded `loop-sessions-<run_id>` artifacts and write
 * an evidence report (see `shared/sessions.mjs` for the parsing/aggregation).
 *
 * Usage:
 *   node scripts/loop/sessions.mjs [--limit 50] [--since 2026-10-01]
 *                                  [--out state/reports/sessions-<date>.md]
 *                                  [--json state/reports/sessions-<date>.json]
 *                                  [--dir <local dir of .jsonl sessions>]
 *                                  [--repo owner/name]
 *
 * Without `--out` the markdown goes to stdout. `--dir` analyses an already-downloaded
 * tree (used for the one-off audit and for offline work); otherwise artifacts are
 * listed and downloaded through `gh` — the same credential the workflow already holds,
 * so no new permission is involved.
 *
 * Failure is loud: a caller that cannot mine (no `gh`, no `unzip`, rate-limited) gets a
 * rejected promise, so the retro host can log it and continue (fail-open) rather than
 * silently treating "no signals" as "nothing wrong".
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parseArgs, readJsonl } from './shared/state.mjs';
import { parseSessionText, aggregate, renderMarkdown } from './shared/sessions.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const log = (m) => console.log(`[sessions] ${m}`);
const warn = (m) => console.warn(`[sessions] warn: ${m}`);

/* ------------------------------------------------------------ local input */

/** Run a command, returning stdout; throws with stderr on a non-zero exit. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.error) throw new Error(`${cmd} failed to start: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${(r.stderr || '').trim()}`);
  }
  return r.stdout;
}

const gh = (args, opts) => run('gh', args, opts);

async function findSessions(dir) {
  const out = [];
  const walk = async (d) => {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  await walk(dir);
  return out.sort();
}

/* ------------------------------------------------------------ run rows */

/** Every row from the state layer's run files (start/checkpoint/end per run). */
async function readAllRunRows(dir) {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.jsonl'));
  const rows = [];
  for (const name of names) rows.push(...(await readJsonl(path.join(dir, name))));
  return rows;
}

/* ---------------------------------------------------------- artifact input */

/** List unexpired `loop-sessions-*` artifacts, newest first, honouring `--since`. */
export function selectArtifacts(artifacts, { limit = 50, since = null } = {}) {
  const cutoff = since ? Date.parse(since) : null;
  return artifacts
    .filter((a) => String(a.name ?? '').startsWith('loop-sessions-') && !a.expired)
    .filter((a) => cutoff == null || Date.parse(a.created_at ?? 0) >= cutoff)
    .sort((a, b) => Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0))
    .slice(0, limit);
}

/** Download one artifact zip and return its `.jsonl` members as `{name, text}`. */
function readArtifactZip(repo, artifact, tmpDir) {
  const zip = path.join(tmpDir, `${artifact.id}.zip`);
  // `gh api` has no `--output`: the zip comes back on stdout as a Buffer.
  const r = spawnSync('gh', ['api', `repos/${repo}/actions/artifacts/${artifact.id}/zip`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error || r.status !== 0) {
    throw new Error(`artifact ${artifact.name} download failed: `
      + `${r.error?.message ?? (r.stderr || '').toString().trim()}`);
  }
  writeFileSync(zip, r.stdout);
  const names = run('unzip', ['-Z1', zip]).split('\n').filter((n) => n.endsWith('.jsonl'));
  const files = names.map((name) => ({
    name: `${artifact.name}/${name}`,
    text: run('unzip', ['-p', zip, name]),
  }));
  return files;
}

async function collectFromGitHub({ repo, limit, since }) {
  const raw = gh(['api', `repos/${repo}/actions/artifacts?per_page=100`]);
  const artifacts = selectArtifacts(JSON.parse(raw).artifacts ?? [], { limit, since });
  if (!artifacts.length) throw new Error(`no unexpired loop-sessions-* artifacts in ${repo}`);
  log(`downloading ${artifacts.length} artifacts from ${repo}`);
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-sessions-'));
  try {
    const files = [];
    for (const a of artifacts) {
      try {
        files.push(...readArtifactZip(repo, a, tmpDir));
      } catch (e) {
        warn(`artifact ${a.name} skipped: ${e.message}`);
      }
    }
    return files;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Mine sessions and write the report. Returns `{ markdown, aggregate, outPath }`.
 * Throws when nothing could be read — callers decide whether that is fatal.
 */
export async function mineSessions({
  repo = process.env.LOOP_REPO ?? null,
  dir = null,
  limit = 50,
  since = null,
  out = null,
  jsonOut = null,
  runsDir = path.join(ROOT, 'state', 'runs'),
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`--limit must be a positive integer (got: ${limit})`);
  }
  let files;
  if (dir) {
    const paths = await findSessions(dir);
    files = await Promise.all(paths.map(async (p) => ({ name: p, text: await fs.readFile(p, 'utf8') })));
  } else {
    if (!repo) throw new Error('no --repo and LOOP_REPO is unset');
    files = await collectFromGitHub({ repo, limit, since });
  }
  if (!files.length) throw new Error('no session files found');

  const sessions = files
    .map((f) => parseSessionText(f.text, f.name))
    .filter((s) => s.runId || s.stage); // a torn/foreign file is not a loop session
  if (!sessions.length) throw new Error(`no parseable loop sessions in ${files.length} file(s)`);

  let runRows = [];
  try {
    runRows = await readAllRunRows(runsDir);
  } catch {
    warn(`run rows unavailable at ${runsDir}; the recorded-token comparison will be empty`);
  }

  const agg = aggregate(sessions, { runRows, generatedAt });
  const markdown = renderMarkdown(agg);

  if (out) {
    await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await fs.writeFile(out, markdown);
  }
  if (jsonOut) {
    await fs.mkdir(path.dirname(path.resolve(jsonOut)), { recursive: true });
    await fs.writeFile(jsonOut, `${JSON.stringify(agg, null, 2)}\n`);
  }
  return { markdown, aggregate: agg, outPath: out };
}

/* ------------------------------------------------------------------- CLI */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('usage: node scripts/loop/sessions.mjs [--limit N] [--since ISO] '
      + '[--out FILE.md] [--json FILE.json] [--dir SESSION_TREE] [--repo OWNER/NAME]\n');
    return;
  }
  const { dir = null, limit = '50', since = null, out = null, json: jsonOut = null } = args;
  const repo = args.repo ?? process.env.LOOP_REPO ?? null;
  const { markdown, aggregate: agg } = await mineSessions({
    repo, dir, limit: Number(limit), since, out, jsonOut,
  });
  if (!out) process.stdout.write(markdown);
  const c = agg.corpus;
  log(`${c.sessions} sessions, ${c.toolCalls} tool calls, ${c.toolErrors} failures, `
    + `${c.engineFaults} engine faults, ${c.billedTokens.toLocaleString('en-US')} tokens processed`
    + `${out ? ` → ${out}` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`[sessions] error: ${e.message}`);
    process.exit(1);
  });
}
