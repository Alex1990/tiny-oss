#!/usr/bin/env node
/**
 * Loop runner orchestration entry — the only script the GitHub Actions job calls.
 *
 * One invocation = one decision: route the event → write inbox / write metrics / run one run.
 * All state layer reads and writes go through `shared/state.mjs`; this file only orchestrates
 * and reports, and never edits state fields directly.
 *
 * Invariants:
 *   - finish is the **single writer**: the agent only writes
 *     `state/reports/<runId>.result.json`, and this file calls finishRun to persist state
 *     (05 §5.1 lists finish as a run-script ritual).
 *   - Under the report boundary no GitHub write happens (write actions only enter the
 *     report as a checklist).
 *   - Event idempotence: `eventIds` records consumed event keys, a duplicate delivery → no-op.
 *
 * Environment contract (injected by the workflow):
 *   LOOP_EVENT_NAME / LOOP_EVENT_ACTION / LOOP_EVENT_JSON / LOOP_REPO
 *   LOOP_WRITE_LEVEL (report|auto, default report)
 *   LOOP_MODEL (pi's --model, e.g. deepseek/deepseek-flash)
 *   LOOP_RUN_TIMEOUT_MS, LOOP_SESSION_DIR, GITHUB_STEP_SUMMARY
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  makeState, ensureDirs, readJson, readJsonl, writeJson, saveTask, listTasks,
  appendAcceptance, markTaskTerminal, GATE_TRANSITIONS, renderStateSummary,
  beginRun, finishRun, lockExpired,
  nowIso, outcomeAllowed, allowedOutcomes, describeActions,
} from './shared/state.mjs';
import { route, eventKey } from './shared/route.mjs';
import { buildPrompt, runPi, parseEvents, summarize, classify } from './shared/agent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = makeState(ROOT);

const log = (m) => console.log(`[loop] ${m}`);
const warn = (m) => console.warn(`[loop] warn: ${m}`);

/* ------------------------------------------------------------ GitHub read */

function ghJson(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

const GH_FIELDS = 'number,title,body,state,labels,url';

/**
 * When the task file is missing, create it from GitHub; if it already exists, mirror the
 * labels (GitHub wins).
 */
async function prepareTask({ taskId, kind, repo }) {
  const existing = await readJson(S.taskFile(taskId));
  if (existing) {
    if (kind === 'pr') existing.kind = 'pr';
    return existing;
  }
  const data = kind === 'pr'
    ? ghJson(['pr', 'view', String(taskId), '-R', repo, '--json', `${GH_FIELDS},headRefName,author`])
    : ghJson(['issue', 'view', String(taskId), '-R', repo, '--json', GH_FIELDS]);
  const t = {
    id: data.number, kind, title: data.title, url: data.url, body: data.body ?? '',
    status: 'new', stage: null, labels: (data.labels ?? []).map((l) => l.name),
    createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
    agentPlan: null, prs: [], runs: [], timeline: [], eventInbox: [], eventIds: [],
  };
  t.timeline.push({ at: t.createdAt, event: 'created', by: 'workflow', detail: `${kind} from GitHub` });
  await writeJson(S.taskFile(t.id), t);
  log(`task #${t.id} created (${kind})`);
  return t;
}

const claimability = (t) => {
  if (t.status === 'processing') {
    return lockExpired(t.lockedBy)
      ? { ok: true, resume: true }
      : { ok: false, reason: `held by ${t.lockedBy?.runId}` };
  }
  return ['new', 'ready', 'waiting-info'].includes(t.status)
    ? { ok: true }
    : { ok: false, reason: `status=${t.status}` };
};

/* -------------------------------------------------------------- event inbox */

function summarizeEvent(ctx) {
  const e = ctx.event ?? {};
  const who = e.comment?.user?.login ?? e.sender?.login ?? '?';
  const body = e.comment?.body ?? e.issue?.body ?? e.pull_request?.body ?? '';
  return `${ctx.eventName}.${ctx.action} by ${who}: ${String(body).replace(/\s+/g, ' ').slice(0, 200)}`;
}

/**
 * Follow-up information events: never silently dropped. First land in eventInbox, then decide
 * whether to re-run based on task status (05 §3 decision order).
 */
async function handleInbox({ ctx, repo }) {
  const key = eventKey(ctx);
  const taskId = ctx.event?.issue?.number ?? ctx.event?.pull_request?.number;
  const t = await readJson(S.taskFile(taskId));
  if (!t) {
    log(`event not inboxed: no task for #${taskId} yet (lifecycle event creates it first)`);
    return { state: 'noop', note: `#${taskId} has no matching task, event not inboxed` };
  }
  if ((t.eventIds ?? []).includes(key)) {
    log(`event already consumed (idempotent skip): ${key}`);
    return { state: 'noop', note: `event already consumed (${key})` };
  }

  t.eventInbox = [...(t.eventInbox ?? []), {
    id: key, type: `${ctx.eventName}.${ctx.action}`, at: nowIso(), summary: summarizeEvent(ctx),
  }];
  t.eventIds = [...(t.eventIds ?? []), key].slice(-50);
  await saveTask(S, t);

  // new/ready re-run the original stage; waiting-info re-runs triage; other states await a consumer
  if (['new', 'ready'].includes(t.status)) {
    return { state: 'run', taskId: t.id, stage: t.stage ?? 'triage', kind: t.kind, note: 're-run' };
  }
  if (t.status === 'waiting-info') {
    return {
      state: 'run', taskId: t.id, stage: 'triage', kind: t.kind, note: 're-triage on new info',
    };
  }
  log(`event inboxed, no run produced: task #${t.id} status=${t.status} (awaiting a consumer)`);
  return {
    state: 'inbox-only',
    note: `task status=${t.status}, event inboxed and awaiting consumption`,
  };
}

/* ---------------------------------------------------------------- metrics */

/**
 * GitHub gate events (a loop PR merged / closed unmerged, a release) are the only
 * place a task reaches a terminal state without a run. Two effects, each
 * idempotent on its own footing:
 *   1. append the acceptance row (deduplicated by taskId+event+pr);
 *   2. move the task to its terminal state.
 * They are deliberately not gated on each other — if the process dies between
 * them, a repeated event still repairs the task instead of leaving it stranded.
 */
async function handleMetrics({ decision }) {
  const row = { at: nowIso(), ...decision.metrics };
  if (row.event === 'released' && !row.taskId) {
    const cands = (await listTasks(S))
      .filter((t) => ['waiting-merge', 'accepted'].includes(t.status))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    if (cands.length) {
      row.taskId = cands[0].id;
      row.backfilledFrom = 'most-recent-waiting-merge';
    }
  }
  const wrote = await appendAcceptance(S, row);

  let transition = null;
  const to = GATE_TRANSITIONS[row.event];
  if (to && row.taskId) {
    transition = await markTaskTerminal(S, row.taskId, to, {
      event: row.event,
      detail: `${row.pr ? `PR #${row.pr} ` : ''}${row.event}`,
    });
    if (transition.changed) {
      log(`task #${row.taskId}: ${transition.from} → ${to} (${row.event})`);
      await renderStateSummary(S);
    } else {
      log(`task #${row.taskId}: no transition needed (${transition.reason})`);
    }
  }
  return { state: 'metrics', wrote, row, transition };
}

/* ------------------------------------------------------------------ run */

async function doRun({ decision, ctx, repo, writeLevel }) {
  const stage = decision.stage;
  const isSystem = !decision.taskId;
  let task = null;

  if (!isSystem) {
    const kind = decision.kind ?? 'issue';
    task = await prepareTask({ taskId: decision.taskId, kind, repo });
    const claim = claimability(task);
    if (!claim.ok) {
      // A skip must be logged: during an event storm, a human must see at a glance in the
      // Actions log that "this event was correctly skipped", not think it silently failed.
      log(`skip: task #${task.id} not claimable (${claim.reason}) — event handled idempotently`);
      return { state: 'skipped', note: `task #${task.id} not claimable: ${claim.reason}` };
    }
    if (claim.resume) warn(`task #${task.id} lock expired, taking over and resuming`);
  }

  const rid = await beginRun(S, task, stage, {
    sandbox: 'actions-ubuntu-24.04',
    trigger: `${ctx.eventName}.${ctx.action || '(none)'}`,
    model: process.env.LOOP_MODEL ?? null,
  });
  log(`run ${rid} started (`
    + `${task ? `task #${task.id}, ` : 'system-level, '}stage=${stage}`
    + `${decision.mode === 'readonly' ? ', readonly' : ''})`);

  const prompt = buildPrompt({
    task, stage, runId: rid, writeLevel, mode: decision.mode, repo,
    lead: [
      `trigger: ${ctx.eventName}.${ctx.action || '(none)'} — ${decision.reason}`,
      decision.loopTask ? `linked issue: #${decision.loopTask}` : null,
    ].filter(Boolean),
  });

  const sessionDir = process.env.LOOP_SESSION_DIR ?? path.join(os.tmpdir(), 'loop-pi', rid);
  const timeoutMs = Number(process.env.LOOP_RUN_TIMEOUT_MS ?? 55 * 60 * 1000);

  const res = await runPi({
    prompt, cwd: ROOT, sessionDir,
    model: process.env.LOOP_MODEL,
    timeoutMs,
    log,
  });
  const events = parseEvents(res.stdout);
  const { usage, stopReason, toolCalls, turns } = summarize(events);

  // the agent's result file (the orchestration layer is the single writer for finish)
  const result = await readJson(path.join(S.reportsDir, `${rid}.result.json`));
  const cls = classify({ code: res.code, signal: res.signal, stderr: res.stderr, timedOut: res.timedOut, stopReason });

  let outcome; let note;
  if (result?.outcome && outcomeAllowed(stage, result.outcome)) {
    outcome = result.outcome;
    note = result.note ?? `agent decision (exit=${res.code})`;
  } else if (result?.outcome) {
    outcome = 'failed';
    note = `agent returned outcome=${result.outcome}, but stage=${stage} does not allow it `
      + `(allowed: ${allowedOutcomes(stage).join(', ')})`;
    warn(note);
  } else {
    outcome = cls.exit === 1 ? 'failed' : 'retry';
    note = `${cls.reason} (no result file)`;
    warn(`no ${rid}.result.json found — ${note}`);
  }

  const { task: done, actions } = await finishRun(S, {
    runId: rid, outcome, note,
    comment: result?.comment ?? null,
    decision: result?.decision ?? null,
    pr: result?.pr ?? null,
    tokens: usage?.totalTokens ?? null,
    writeLevel, log, warn,
  });

  log(`run ${rid} finished: outcome=${outcome} (exit ${cls.exit})`
    + `${usage?.totalTokens ? `, tokens=${usage.totalTokens}` : ''}`);
  if (actions.length) {
    log(writeLevel === 'auto'
      ? `GitHub actions executed: ${actions.length}`
      : `GitHub actions not executed (report boundary): ${actions.length} `
        + 'pending human review, see the report and Step Summary');
  }
  if (done) log(`task #${done.id} → status=${done.status}${done.labels?.length ? `, label=${done.labels.join(',')}` : ''}`);

  return {
    state: 'run', taskId: done?.id ?? decision.taskId ?? null, runId: rid, stage, outcome,
    exit: cls.exit, actions, usage, toolCalls, turns, sessionDir, system: isSystem,
    reportFile: path.join(S.reportsDir, `${rid}.md`),
  };
}

/* --------------------------------------------------------- Step Summary */

async function writeStepSummary(md) {
  const f = process.env.GITHUB_STEP_SUMMARY;
  if (!f) { log('(no GITHUB_STEP_SUMMARY, skipping)'); return; }
  await fs.appendFile(f, md + '\n', 'utf8');
}

async function readTextSafe(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

function renderStepSummary({ decision, result, writeLevel }) {
  const L = [`## Loop — ${decision.action}`, ''];
  L.push(`- event: \`${decision.reason}\``);
  if (result?.runId) {
    const who = result.system ? 'system-level' : `task #${result.taskId}`;
    L.push(`- run: \`${result.runId}\` · ${who} · stage \`${result.stage}\``);
    L.push(`- **outcome: ${result.outcome}** (exit ${result.exit})`);
    if (result.usage) {
      L.push(`- usage: in ${result.usage.input ?? '-'} / out ${result.usage.output ?? '-'}`
        + ` / total ${result.usage.totalTokens ?? '-'} tokens · $${result.usage.cost?.total ?? '-'}`
        + ` · ${result.toolCalls} tool calls, ${result.turns} turns`);
    }
  } else if (result?.note) {
    L.push(`- ${result.state}: ${result.note}`);
  }
  if (result?.transition) {
    const tr = result.transition;
    L.push(tr.changed
      ? `- task #${tr.task.id}: **${tr.from} → ${tr.task.status}**`
      : `- task: no transition needed (${tr.reason})`);
  }
  if (result?.actions?.length) {
    const head = writeLevel === 'auto' ? '### GitHub actions executed' : '### Proposed GitHub actions (report boundary — NOT executed)';
    L.push('', head, '');
    for (const d of describeActions(result.actions)) L.push(`- [${writeLevel === 'auto' ? 'x' : ' '}] ${d}`);
  }
  return L.join('\n');
}

/* ----------------------------------------------------------------- main */

async function main() {
  const eventName = process.env.LOOP_EVENT_NAME ?? 'workflow_dispatch';
  const action = process.env.LOOP_EVENT_ACTION ?? '';
  const event = JSON.parse(process.env.LOOP_EVENT_JSON || '{}');
  const repo = process.env.LOOP_REPO ?? 'Alex1990/tiny-oss';
  // Write boundary: the workflow passes LOOP_EXECUTE_WRITES (the workflow_dispatch dry-run
  // switch), but an explicit LOOP_WRITE_LEVEL override wins (used for local debugging).
  const writeLevel = process.env.LOOP_WRITE_LEVEL
    ?? (process.env.LOOP_EXECUTE_WRITES === 'true' ? 'auto' : 'report');

  await ensureDirs(S);
  const ctx = { eventName, action, event };
  const decision = route(ctx);
  log(`event=${eventName}.${action || '(none)'} → ${decision.action} `
    + `(${decision.reason}) · writeLevel=${writeLevel}`);

  // Smoke mode: verify infrastructure only (checkout / toolchain / pi install / R2 pull+push)
  // and never start an agent. A1's manual smoke entry point must answer two questions without
  // spending tokens or waiting for an LLM: is the pipeline alive, and is the freshly pulled
  // state layer correct?
  if (process.env.LOOP_SMOKE === 'true') {
    log('smoke mode: skipping the agent, verifying infrastructure only');
    const tasks = await listTasks(S);
    const byStatus = {};
    for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    const acc = await readJsonl(S.acceptanceFile);
    const runFiles = (await fs.readdir(S.runsDir).catch(() => [])).filter((f) => f.endsWith('.jsonl'));
    const reports = (await fs.readdir(S.reportsDir).catch(() => [])).filter((f) => f.endsWith('.md'));
    const summaryExists = await fs.access(S.summaryFile).then(() => true, () => false);

    const overview = [
      `- tasks: ${tasks.length}${tasks.length ? ` (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')})` : ''}`,
      `- runs: ${runFiles.length}`,
      `- reports: ${reports.length}`,
      `- acceptance rows: ${acc.length}`,
      `- SUMMARY.md: ${summaryExists ? 'present' : 'MISSING'}`,
    ];
    for (const l of overview) log(l.replace(/^- /, '  '));

    const expectsState = process.env.LOOP_EXPECT_TASKS;
    if (expectsState && String(tasks.length) !== String(expectsState)) {
      await writeStepSummary(`## Loop — smoke FAILED\n\nExpected ${expectsState} tasks in the state layer, found ${tasks.length}. The R2 pull is not returning what was seeded.\n`);
      throw new Error(`state layer has ${tasks.length} tasks, expected ${expectsState}`);
    }

    await writeStepSummary([
      '## Loop — smoke (infrastructure only)', '',
      `- event: \`${eventName}.${action || '(none)'}\``,
      `- routing decision (not executed): \`${decision.action}\` — ${decision.reason}`,
      `- write level: \`${writeLevel}\``,
      '- R2: pulled and pushed by the surrounding workflow steps',
      '- agent: **skipped** (no tokens spent)',
      '',
      '### State layer as pulled',
      '',
      ...overview,
    ].join('\n'));
    return 0;
  }

  let result = { state: 'noop', note: decision.reason };

  if (decision.action === 'run') {
    result = await doRun({ decision, ctx, repo, writeLevel });
  } else if (decision.action === 'inbox') {
    const r = await handleInbox({ ctx, repo });
    if (r.state === 'run') {
      result = await doRun({
        decision: {
          ...decision, taskId: r.taskId, stage: r.stage, kind: r.kind,
          reason: `${decision.reason} (${r.note})`,
        },
        ctx, repo, writeLevel,
      });
    } else result = r;
  } else if (decision.action === 'metrics') {
    result = await handleMetrics({ decision });
    log(result.wrote
      ? `metrics written: ${JSON.stringify(result.row)}`
      : 'metrics already present, skipped (idempotent)');
  }

  await writeStepSummary(renderStepSummary({ decision, result, writeLevel }));
  return 0; // noop / inbox-only / metrics / a completed run all exit successfully
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error(`[loop] error: ${e?.stack ?? e}`);
    await writeStepSummary(`## Loop — FAILED\n\n\`\`\`\n${e?.message ?? e}\n\`\`\`\n`).catch(() => {});
    process.exit(1);
  });
