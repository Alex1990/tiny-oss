#!/usr/bin/env node
/**
 * tiny-oss Loop local host (CLI)
 *
 * All state layer primitives come from `./shared/state.mjs` (shared with the
 * runner orchestrator entry.mjs, so there is a single implementation). This
 * file only handles the manually driven command-line ceremony.
 *
 * Usage (`pnpm loop` = this file, see package.json):
 *   pnpm loop start  [--stage <triage|bugfix|feature|...>] [--task <n>]
 *                     [--new --title "..." --body "..."]   # create a local synthetic task
 *                     [--issue <gh#>]                      # import a GitHub issue (gh, read-only)
 *   pnpm loop checkpoint --run <runId> --note "..."
 *   pnpm loop end     --run <runId> --outcome <outcome> [--comment "..."] [--label <n>]
 *                      [--task <n>]                        # look up an unfinished run (D2)
 *   pnpm loop summary | view [--run <runId> | --task <n>]
 *
 * Write level (--write-level | LOOP_WRITE_LEVEL, default report):
 *   report  only writes the state layer + report: GitHub write actions are
 *           presented solely as a "pending human action" checklist (A1 semantics)
 *   auto    performs labelling/commenting/closing (A0 delegated semantics; the
 *           norm once we move to L2)
 *
 * outcome values and state transitions (ops.md "Labels → task state"):
 *   triaged      → ready          + ready-for-agent
 *   needs-info   → waiting-info   + needs-info
 *   needs-triage → waiting-human  + needs-triage
 *   pr-opened    → waiting-merge  + ready-for-human
 *   closed       → closed          None
 *   rejected     → rejected        None
 *   accepted     → accepted        None
 *   failed       → waiting-human  + needs-triage
 *
 * D9: at claim time, if the local task is in a terminal state (closed/rejected)
 * but the GitHub issue has been reopened as OPEN, automatically reset to ready +
 * clear decision + record reopened in the timeline, then claim, back to triage.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  makeState, ensureDirs, loadTask, saveTask, nextTaskId, listTasks,
  readRunLines, appendRunRow, readJson, writeJson,
  nowIso, parseArgs, renderSummary,
  OUTCOME_MAP, lockExpired, describeActions,
  beginRun, finishRun,
} from './shared/state.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = makeState(ROOT);

const WRITE_LEVELS = ['report', 'auto'];

function fail(msg) {
  console.error(`[loop] error: ${msg}`);
  process.exit(1);
}

function resolveWriteLevel(args) {
  const wl = args['write-level'] ?? process.env.LOOP_WRITE_LEVEL ?? 'report';
  if (!WRITE_LEVELS.includes(wl)) fail(`--write-level must be ${WRITE_LEVELS.join('|')} ` +
    `(got: ${wl})`);
  return wl;
}

/* ---------------------------------------------------------------- start */

async function cmdStart(args) {
  const { stage, task, 'new': isNew, title, body, issue, pr, url } = args;
  await ensureDirs(S);
  const s = stage ?? 'triage';
  if (!stage) console.log('[loop] --stage omitted, defaulting to triage');

  let t;
  if (isNew || issue || pr) {
    if (isNew && !title) fail('--new requires --title');
    let id;
    let kind = 'issue';
    let extra = {};
    if (pr) {
      // PRs and issues share the triage surface (issue-tracker.md): kind keeps
      // them apart, the numbering space is the same.
      const gh = spawnSync('gh', ['pr', 'view', String(pr), '--json',
        'number,title,body,state,labels,url'], { encoding: 'utf8' });
      if (gh.status !== 0) fail(`gh pr view failed (gh missing or unauthenticated?): ` +
        `${(gh.stderr || '').trim()}`);
      const it = JSON.parse(gh.stdout);
      if (it.state !== 'OPEN') fail(`PR #${it.number} is ${it.state}; ` +
        `only OPEN PRs can be imported (D1)`);
      id = it.number;
      kind = 'pr';
      extra = { url: it.url };
      t = {
        id, kind, title: it.title, url: it.url, body: it.body,
        status: 'new', stage: null, labels: (it.labels || []).map((l) => l.name),
        createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
        agentPlan: null, prs: [id], runs: [], timeline: [], eventInbox: [], eventIds: [],
      };
    } else if (issue) {
      const gh = spawnSync('gh', ['issue', 'view', String(issue), '--json',
        'number,title,body,state,labels,url'], { encoding: 'utf8' });
      if (gh.status !== 0) fail(`gh issue view failed (gh missing or unauthenticated?): ` +
        `${(gh.stderr || '').trim()}`);
      const it = JSON.parse(gh.stdout);
      if (it.state !== 'OPEN') fail(`#${it.number} is ${it.state}; ` +
        `only OPEN issues can be imported (D1)`);
      id = it.number;
      extra = { url: it.url };
      t = {
        id, kind, title: it.title, url: it.url, body: it.body,
        status: 'new', stage: null, labels: (it.labels || []).map((l) => l.name),
        createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
        agentPlan: null, prs: [], runs: [], timeline: [],
      };
    } else {
      id = await nextTaskId(S);
      t = {
        id, kind, title, url: url ?? null, body: body ?? '',
        status: 'new', stage: null, labels: [],
        createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
        agentPlan: null, prs: [], runs: [], timeline: [],
      };
      extra = { synthetic: true };
    }
    if (await readJson(S.taskFile(id))) {
      fail(`task #${id} already exists, refusing to overwrite (${S.taskFile(id)}); ` +
        `rerun: start --task ${id} [--stage <s>] (D3)`);
    }
    t.timeline.push({ at: t.createdAt, event: 'created', by: 'manual', ...extra });
    await writeJson(S.taskFile(id), t);
    console.log(`[loop] task #${id} created (` +
      `${isNew ? 'local synthetic' : pr ? 'GitHub PR import' : 'GitHub import'})`);
  } else {
    t = await loadTask(S, task ?? fail('--task <n> or --pr/--issue/--new is required'));
  }

  // Claim check: new/ready/waiting-info are claimable; a live processing lock
  // refuses the claim, an expired one can be overridden; a task the loop had
  // already closed, whose GitHub item was reopened, is reset to ready (D9).
  const claimable = ['new', 'ready', 'waiting-info'];
  // D9 applies to terminal states only. `accepted` is terminal but means
  // "delivered and merged", and `waiting-human`/`waiting-merge` are open by
  // definition — a waiting-human task is in the inbox *because* a human must
  // decide, so finding its GitHub item open is the normal case, not a reopen.
  // Treating any non-claimable state as reopened silently turned inbox tasks
  // into auto-claimable ones and wiped their triage decision.
  const reopenable = ['closed', 'rejected'];
  if (t.status === 'processing') {
    if (!lockExpired(t.lockedBy)) {
      fail(`task #${t.id} is held by ${t.lockedBy?.runId ?? '?'} (status=processing), ` +
        `finish it or wait for the TTL to expire`);
    }
    console.warn(`[loop] warn: task #${t.id} lock expired ` +
      `(${t.lockedBy?.runId}), taking over to resume`);
  } else if (reopenable.includes(t.status) && t.url) {
    const repo = repoOf(t.url);
    const ghState = repo
      ? spawnSync('gh', ['issue', 'view', String(t.id), '-R', repo, '--json', 'state', '-q', '.state'], { encoding: 'utf8' })
      : null;
    if (ghState && ghState.status === 0 && ghState.stdout.trim() === 'OPEN') {
      console.warn(`[loop] warn: task #${t.id} local status=${t.status}, GitHub issue ` +
        `reopened → reset to ready (D9)`);
      t.status = 'ready';
      t.decision = null;
      t.timeline.push({ at: nowIso(), event: 'reopened', by: 'github',
        detail: 'GitHub issue reopened → terminal state reset to ready (D9)' });
    }
  }
  if (!claimable.includes(t.status)) {
    const hint = t.status === 'waiting-human'
      ? 'it is in the human inbox — a human decides first (label/status), then it can be claimed'
      : t.status === 'waiting-merge'
        ? 'it is awaiting a human merge'
        : `terminal states (${reopenable.join('/')}) whose GitHub item was reopened are let through`;
    fail(`task #${t.id} status=${t.status} is not claimable (claimable: ${claimable.join('/')}); ${hint}`);
  }

  const rid = await beginRun(S, t, s, { sandbox: `local:${process.platform}`, trigger: 'manual' });

  console.log(`[loop] run started: ${rid}`);
  console.log(`[loop] task #${t.id} (stage=${s}) claimed → ` +
    `${path.relative(ROOT, S.taskFile(t.id))}`);
  console.log('[loop] opening ritual: read AGENTS.md → docs/agents/ops.md → the matching skill:');
  const skillFile = path.join(ROOT, 'skills', s, 'SKILL.md');
  const hasSkill = await fs.access(skillFile).then(() => true, () => false);
  console.log(hasSkill
    ? `[loop]              skills/${s}/SKILL.md`
    : `[loop]              skills/${s}/SKILL.md not found (no skill for this stage; ` +
      `read the matching one when you reach verify/review)`);
  console.log(`[loop] write level: ${resolveWriteLevel(args)} ` +
    `(report = only writes the state layer and report, GitHub write actions are only listed)`);
  console.log('[loop] checkpoints can be recorded along the way; when done run:');
  console.log(`  pnpm loop end --run ${rid} --outcome <${Object.keys(OUTCOME_MAP).join('|')}> [--comment "..."] [--note "..."]`);
}

/* ------------------------------------------------------------------ end */

async function cmdEnd(args) {
  const { run, task, outcome, note, comment, label, decision, pr, 'no-github': noGithub } = args;
  const wl = resolveWriteLevel(args);
  let rid = run;
  if (!rid) {
    if (!task) fail('--run <runId> or --task <n> (look up an unfinished run) is required');
    const t0 = await loadTask(S, task);
    const open = [];
    for (const r of [...t0.runs].reverse()) {
      const ls = await readRunLines(S, r);
      if (ls.length && !ls.some((l) => l.event === 'end')) open.push(r);
    }
    if (!open.length) fail(`task #${task} has no unfinished run`);
    if (open.length > 1) fail(`task #${task} has multiple unfinished runs ` +
      `(${open.join(', ')}); pick one with --run`);
    rid = open[0];
    console.log(`[loop] looked up unfinished run: ${rid}`);
  }
  try {
    const { task: t, actions, applied } = await finishRun(S, {
      runId: rid, outcome, note, comment, label, decision, pr,
      writeLevel: wl, noGithub,
      log: console.log, warn: console.warn,
    });
    const m = OUTCOME_MAP[outcome];
    console.log(`[loop] run ${rid} finish: outcome=${outcome}`);
    console.log(`[loop] task #${t.id} → status=${t.status}${m.label ? `, label=${m.label}` : ''}`);
    if (actions.length) {
      if (wl === 'auto') {
        console.log(`[loop] GitHub write actions applied ${applied.length}/${actions.length}`);
      } else {
        console.log('[loop] write level=report: GitHub write actions awaiting human execution');
        for (const d of describeActions(actions)) console.log(`  - ${d}`);
        console.log(`[loop] appended to report: ` +
          `${path.relative(ROOT, path.join(S.reportsDir, `${rid}.md`))}`);
      }
    } else if (noGithub) {
      console.log('[loop] --no-github: skipping GitHub write actions');
    }
    console.log('[loop] SUMMARY.md refreshed');
  } catch (e) {
    fail(e.message);
  }
}

function repoOf(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

/* ----------------------------------------------------------- checkpoint */

async function cmdCheckpoint(args) {
  const { run: rid, note } = args;
  if (!rid || !note) fail('--run <runId> --note "..." is required');
  const rows = await readRunLines(S, rid);
  if (!rows.length) fail(`run ${rid} does not exist`);
  await appendRunRow(S, rid, { runId: rid, event: 'checkpoint', at: nowIso(), note });
  console.log(`[loop] run ${rid} checkpoint recorded`);
}

/* ---------------------------------------------------------------- view */

async function cmdView(args) {
  const { run: rid, task } = args;
  if (rid) {
    const rows = await readRunLines(S, rid);
    if (!rows.length) fail(`run ${rid} does not exist`);
    for (const l of rows) console.log(JSON.stringify(l, null, 2));
    return;
  }
  if (task) {
    console.log(JSON.stringify(await loadTask(S, task), null, 2));
    return;
  }
  for (const t of (await listTasks(S)).sort((a, b) => a.id - b.id)) {
    console.log(`#${t.id}\t${t.status}\t${t.stage ?? '-'}\t${(t.labels || []).join(',')}\t${t.title}`);
  }
}

/* ---------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`usage:
  pnpm loop start [--stage <stage>] --task <n>   # stage defaults to triage
                  [--pr <n> | --issue <gh#> | --new --title ".." [--body ".."]]
  pnpm loop checkpoint --run <runId> --note ".."
  pnpm loop end --run <runId> --outcome <outcome> [--note ".."] [--comment ".."]
       [--label <name>] [--no-github] [--task <n>]
       [--write-level report|auto]   # default report: GitHub write actions are only listed
  pnpm loop summary | view [--run <id>|--task <n>]
outcome (task): ${Object.keys(OUTCOME_MAP).join(' | ')}
outcome (system-level run): completed | failed | retry | aborted
state root: ${S.root} (env STATE_DIR overrides)
write level: LOOP_WRITE_LEVEL=report|auto (default report)`);
    return;
  }
  const args = parseArgs(argv.slice(1));
  await ensureDirs(S);
  // The shared library throws (it is used by the orchestrator too, where a throw is
  // right); a CLI should print a one-line reason instead of a stack trace. Catch it
  // here so every subcommand behaves the same way.
  try {
    if (cmd === 'start') return await cmdStart(args);
    if (cmd === 'end') return await cmdEnd(args);
    if (cmd === 'checkpoint') return await cmdCheckpoint(args);
    if (cmd === 'summary') return await renderSummary(S);
    if (cmd === 'view') return await cmdView(args);
  } catch (e) {
    fail(e.message);
  }
  fail(`unknown subcommand ${cmd} (see --help for usage)`);
}

await main();
