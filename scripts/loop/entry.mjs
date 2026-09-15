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
  nowIso, outcomeAllowed, allowedOutcomes, describeActions, LOOP_BRANCH_RE,
} from './shared/state.mjs';
import { route, eventKey, stageForIssue } from './shared/route.mjs';
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

/* --------------------------------------------------------------- terminal */

/**
 * Terminalise a task with no metric attached — a PR that closed was not
 * loop-produced, so it must not enter the acceptance rate, but its task still has
 * to finish. Shares `markTaskTerminal` with the metrics path so there is one
 * definition of "what terminal means".
 */
async function handleTaskTerminal({ decision }) {
  const transition = await markTaskTerminal(S, decision.taskId, decision.to, {
    event: decision.to === 'accepted' ? 'merged' : 'closed-unmerged',
    detail: `${decision.pr ? `PR #${decision.pr} ` : ''}${decision.reason}`,
  });
  if (transition.changed) {
    log(`task #${decision.taskId}: ${transition.from} → ${decision.to} (${decision.reason})`);
    await renderStateSummary(S);
  } else {
    log(`task #${decision.taskId}: no transition needed (${transition.reason})`);
  }
  return { state: 'terminal', transition, note: decision.reason };
}

/* ------------------------------------------------------------------ run */

/**
 * A `pr-opened` outcome is a claim the host has to back with a push, so it is checked
 * before it can move a task to `waiting-merge`. An unbacked claim is the D33 failure
 * mode in a new place: the task would sit in the inbox forever waiting for a PR that
 * never existed, and nothing in the loop could see that.
 *
 * The branch shape is enforced here as well as in `applyActions` (which re-checks it
 * against the credential it is about to spend) because a mismatch is an agent error
 * worth reporting as `failed`, not a silent no-op.
 */
function validatePush({ writeLevel, stage, taskId, push }) {
  if (writeLevel !== 'auto') {
    return { ok: false, reason:
      `stage=${stage} cannot open a PR at writeLevel=${writeLevel}: the report boundary `
      + 'forbids pushing a branch. The stage must report what it produced instead.' };
  }
  if (!push || typeof push !== 'object') {
    return { ok: false, reason: 'no "push" proposal in the result file (branch/title missing)' };
  }
  const branch = String(push.branch ?? '');
  if (!LOOP_BRANCH_RE.test(branch)) {
    return { ok: false, reason:
      `branch "${branch}" does not match loop/<issueNo>-<slug> (ops.md; `
      + 'the host pushes nothing else)' };
  }
  if (!branch.startsWith(`loop/${taskId}-`)) {
    return { ok: false, reason:
      `branch "${branch}" does not carry this task's number — the router pairs the ref `
      + `with the body marker, so it must start with loop/${taskId}-` };
  }
  if (!String(push.title ?? '').trim()) return { ok: false, reason: 'the PR title is empty' };
  return { ok: true, push: { ...push, branch } };
}

/**
 * Hand a triaged task to the stage that implements it.
 *
 * The obvious mechanism — let triage's `ready-for-agent` label raise an
 * `issues.labeled` run — cannot work when the loop applies that label itself:
 * GitHub suppresses workflow runs for events raised by `GITHUB_TOKEN`, precisely so
 * a workflow cannot call itself in a loop. `workflow_dispatch` is the documented
 * exception (it *always* creates a run), so the host asks for the next stage
 * explicitly. One run stays one stage; the cost is `actions: write`.
 *
 * Not dispatching is not a failure of this run: the task is `ready` and the label is
 * on the issue, so a human can start it by hand or a later sweep can pick it up. It
 * is worth a warning because it stalls the claim silently otherwise.
 */
function dispatchStage({ repo, taskId, stage, log, warn }) {
  const r = spawnSync('gh', ['workflow', 'run', 'loop.yml', '-R', repo,
    '-f', `task=${taskId}`, '-f', `stage=${stage}`], { encoding: 'utf8' });
  if (r.status !== 0) {
    warn(`stage=${stage} not dispatched for task #${taskId}: `
      + `${(r.stderr || '').trim()} — the task is claimable, start it by hand or let a`
      + ' sweep pick it up');
    return false;
  }
  log(`dispatched stage=${stage} for task #${taskId} (the loop cannot trigger itself`
    + ' with a label, so it asks explicitly)');
  return true;
}

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
    writeLevel,
    log,
  });
  const events = parseEvents(res.stdout);
  const { usage, stopReason, toolCalls, turns } = summarize(events);

  // the agent's result file (the orchestration layer is the single writer for finish)
  const result = await readJson(path.join(S.reportsDir, `${rid}.result.json`));
  const cls = classify({ code: res.code, signal: res.signal, stderr: res.stderr, timedOut: res.timedOut, stopReason });

  let outcome; let note; let push = null;
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

  // `pr-opened` must be backed by a branch the host can actually push.
  if (outcome === 'pr-opened') {
    const v = validatePush({ writeLevel, stage, taskId: task.id, push: result.push });
    if (v.ok) push = v.push;
    else {
      outcome = 'failed';
      note = `pr-opened refused by the host: ${v.reason}`;
      warn(note);
    }
  }

  const { task: done, actions, outcome: finalOutcome } = await finishRun(S, {
    runId: rid, outcome, note,
    comment: result?.comment ?? null,
    decision: result?.decision ?? null,
    pr: result?.pr ?? null,
    // The agent's PR proposal; only `pr-opened` uses it, and the host (not the agent)
    // pushes the branch and opens the PR — see planActions/applyActions.
    push,
    tokens: usage?.totalTokens ?? null,
    writeLevel, cwd: ROOT, log, warn,
  });

  log(`run ${rid} finished: outcome=${finalOutcome} (exit ${cls.exit})`
    + `${finalOutcome !== outcome ? ` [agent said pr-opened, the host downgraded it]` : ''}`
    + `${usage?.totalTokens ? `, tokens=${usage.totalTokens}` : ''}`);
  if (actions.length) {
    log(writeLevel === 'auto'
      ? `GitHub actions executed: ${actions.length}`
      : `GitHub actions not executed (report boundary): ${actions.length} `
        + 'pending human review, see the report and Step Summary');
  }
  if (done) log(`task #${done.id} → status=${done.status}${done.labels?.length ? `, label=${done.labels.join(',')}` : ''}`);

  // Triage decided this is loop work → start the stage that implements it. Only
  // issues: a triaged *PR* would have the loop push a branch and label the PR it is
  // supposed to be reviewing.
  let handedOff = null;
  if (finalOutcome === 'triaged' && done?.kind === 'issue') {
    try {
      const cur = ghJson(['issue', 'view', String(done.id), '-R', repo, '--json', 'labels']);
      const next = stageForIssue(cur.labels);
      if (dispatchStage({ repo, taskId: done.id, stage: next, log, warn })) handedOff = next;
    } catch (e) {
      warn(`could not read task #${done.id} labels to start the next stage: ${e.message}`);
    }
  }

  return {
    state: 'run', taskId: done?.id ?? decision.taskId ?? null, runId: rid, stage,
    outcome: finalOutcome, exit: cls.exit, actions, usage, toolCalls, turns, sessionDir,
    system: isSystem, handedOff, reportFile: path.join(S.reportsDir, `${rid}.md`),
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
  if (result?.handedOff) {
    L.push('', `- handed off to \`${result.handedOff}\` (dispatched; the loop cannot trigger`
      + ' itself with a label)');
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
  } else if (decision.action === 'terminal') {
    result = await handleTaskTerminal({ decision });
  }

  await writeStepSummary(renderStepSummary({ decision, result, writeLevel }));
  return 0; // noop / inbox-only / metrics / terminal / a completed run all exit successfully
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error(`[loop] error: ${e?.stack ?? e}`);
    await writeStepSummary(`## Loop — FAILED\n\n\`\`\`\n${e?.message ?? e}\n\`\`\`\n`).catch(() => {});
    process.exit(1);
  });
