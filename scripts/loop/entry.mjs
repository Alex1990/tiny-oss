#!/usr/bin/env node
/**
 * Loop runner 编排入口 —— GitHub Actions job 调用的唯一脚本。
 *
 * 一次调用 = 一个决策：路由事件 → 落 inbox / 写评测 / 跑一个 run。
 * 状态层读写全部经 `lib/state.mjs`；本文件只做编排与报告，不直接改状态字段。
 *
 * 不变量：
 *   - 收尾是**唯一写入者**：agent 只写 `state/reports/<runId>.result.json`，
 *     由本文件调 finishRun 落状态（05 §5.1 把收尾列为 run 脚本仪式）。
 *   - report 边界下不产生任何 GitHub 写操作（写动作只作为清单进报告）。
 *   - 事件幂等：`eventIds` 记已消费事件键，重复投递 → no-op。
 *
 * 环境契约（workflow 注入）：
 *   LOOP_EVENT_NAME / LOOP_EVENT_ACTION / LOOP_EVENT_JSON / LOOP_REPO
 *   LOOP_WRITE_LEVEL（report|auto，默认 report）
 *   LOOP_MODEL（pi 的 --model，如 deepseek/deepseek-flash）
 *   LOOP_RUN_TIMEOUT_MS、LOOP_SESSION_DIR、GITHUB_STEP_SUMMARY
 */

import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  makeState, ensureDirs, readJson, writeJson, saveTask, listTasks,
  appendAcceptance, beginRun, finishRun, lockExpired,
  nowIso, outcomeAllowed, allowedOutcomes, describeActions,
} from './shared/state.mjs';
import { route, eventKey } from './shared/route.mjs';
import { buildPrompt, runPi, parseEvents, summarize, classify } from './shared/agent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = makeState(ROOT);

const log = (m) => console.log(`[loop] ${m}`);
const warn = (m) => console.warn(`[loop] warn: ${m}`);

/* ------------------------------------------------------------ GitHub 读取 */

function ghJson(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args.join(' ')} 失败: ${(r.stderr || '').trim()}`);
  return JSON.parse(r.stdout);
}

const GH_FIELDS = 'number,title,body,state,labels,url';

/** 任务文件不存在时从 GitHub 拉取建档；已存在则镜像标签（GitHub 为准）。 */
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
  log(`任务 #${t.id} 已建档（${kind}）`);
  return t;
}

const claimability = (t) => {
  if (t.status === 'processing') {
    return lockExpired(t.lockedBy)
      ? { ok: true, resume: true }
      : { ok: false, reason: `被 ${t.lockedBy?.runId} 持有` };
  }
  return ['new', 'ready', 'waiting-info'].includes(t.status)
    ? { ok: true }
    : { ok: false, reason: `status=${t.status}` };
};

/* -------------------------------------------------------------- 事件入箱 */

function summarizeEvent(ctx) {
  const e = ctx.event ?? {};
  const who = e.comment?.user?.login ?? e.sender?.login ?? '?';
  const body = e.comment?.body ?? e.issue?.body ?? e.pull_request?.body ?? '';
  return `${ctx.eventName}.${ctx.action} by ${who}: ${String(body).replace(/\s+/g, ' ').slice(0, 200)}`;
}

/**
 * 信息补足事件：永不静默丢弃。先落 eventInbox，再按任务状态决定是否补跑（05 §3 判定顺序）。
 */
async function handleInbox({ ctx, repo }) {
  const key = eventKey(ctx);
  const taskId = ctx.event?.issue?.number ?? ctx.event?.pull_request?.number;
  const t = await readJson(S.taskFile(taskId));
  if (!t) return { state: 'noop', note: `#${taskId} 无对应任务，事件不入箱` };
  if ((t.eventIds ?? []).includes(key)) return { state: 'noop', note: `事件已消费（${key}）` };

  t.eventInbox = [...(t.eventInbox ?? []), {
    id: key, type: `${ctx.eventName}.${ctx.action}`, at: nowIso(), summary: summarizeEvent(ctx),
  }];
  t.eventIds = [...(t.eventIds ?? []), key].slice(-50);
  await saveTask(S, t);

  // new/ready 补跑原 stage；waiting-info 重新 triage；其余状态留待消费方接手
  if (['new', 'ready'].includes(t.status)) {
    return { state: 'run', taskId: t.id, stage: t.stage ?? 'triage', kind: t.kind, note: '补跑' };
  }
  if (t.status === 'waiting-info') {
    return { state: 'run', taskId: t.id, stage: 'triage', kind: t.kind, note: '补充信息后重新 triage' };
  }
  return { state: 'inbox-only', note: `任务 status=${t.status}，事件已入箱待消费` };
}

/* ---------------------------------------------------------------- 评测 */

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
  return { state: 'metrics', wrote, row };
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
    if (!claim.ok) return { state: 'skipped', note: `任务 #${task.id} 不可领取：${claim.reason}` };
    if (claim.resume) warn(`任务 #${task.id} 锁已过期，接管续跑`);
  }

  const rid = await beginRun(S, task, stage, {
    sandbox: 'actions-ubuntu-24.04',
    trigger: `${ctx.eventName}.${ctx.action || '(none)'}`,
    model: process.env.LOOP_MODEL ?? null,
  });
  log(`run ${rid} 开始（${task ? `task #${task.id}, ` : '系统级, '}stage=${stage}${decision.mode === 'readonly' ? ', readonly' : ''}）`);

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

  // agent 的结论文件（编排层是收尾的唯一写入者）
  const result = await readJson(path.join(S.reportsDir, `${rid}.result.json`));
  const cls = classify({ code: res.code, signal: res.signal, stderr: res.stderr, timedOut: res.timedOut, stopReason });

  let outcome; let note;
  if (result?.outcome && outcomeAllowed(stage, result.outcome)) {
    outcome = result.outcome;
    note = result.note ?? `agent 判定（exit=${res.code}）`;
  } else if (result?.outcome) {
    outcome = 'failed';
    note = `agent 给出 outcome=${result.outcome}，但 stage=${stage} 不允许（允许: ${allowedOutcomes(stage).join(', ')}）`;
    warn(note);
  } else {
    outcome = cls.exit === 1 ? 'failed' : 'retry';
    note = `${cls.reason}（无结果文件）`;
    warn(`未取到 ${rid}.result.json —— ${note}`);
  }

  const { task: done, actions } = await finishRun(S, {
    runId: rid, outcome, note,
    comment: result?.comment ?? null,
    decision: result?.decision ?? null,
    pr: result?.pr ?? null,
    tokens: usage?.totalTokens ?? null,
    writeLevel, log, warn,
  });

  log(`run ${rid} 收尾: outcome=${outcome} (exit ${cls.exit})${usage?.totalTokens ? `, tokens=${usage.totalTokens}` : ''}`);
  if (actions.length) {
    log(writeLevel === 'auto'
      ? `GitHub 动作已执行 ${actions.length} 项`
      : `GitHub 动作未执行（report 边界）：${actions.length} 项待人工，见报告与 Step Summary`);
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
  if (!f) { log('（无 GITHUB_STEP_SUMMARY，跳过）'); return; }
  await fs.appendFile(f, md + '\n', 'utf8');
}

async function readTextSafe(file) {
  try { return await fs.readFile(file, 'utf8'); } catch { return ''; }
}

function renderSummary({ decision, result, writeLevel }) {
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
  // 写边界：workflow 传 LOOP_EXECUTE_WRITES（workflow_dispatch 的预演开关），
  // 也接受显式 LOOP_WRITE_LEVEL 覆盖（本地调试用）。
  const writeLevel = process.env.LOOP_WRITE_LEVEL
    ?? (process.env.LOOP_EXECUTE_WRITES === 'true' ? 'auto' : 'report');

  await ensureDirs(S);
  const ctx = { eventName, action, event };
  const decision = route(ctx);
  log(`event=${eventName}.${action || '(none)'} → ${decision.action}（${decision.reason}）· writeLevel=${writeLevel}`);

  let result = { state: 'noop', note: decision.reason };

  if (decision.action === 'run') {
    result = await doRun({ decision, ctx, repo, writeLevel });
  } else if (decision.action === 'inbox') {
    const r = await handleInbox({ ctx, repo });
    if (r.state === 'run') {
      result = await doRun({
        decision: { ...decision, taskId: r.taskId, stage: r.stage, kind: r.kind, reason: `${decision.reason}（${r.note}）` },
        ctx, repo, writeLevel,
      });
    } else result = r;
  } else if (decision.action === 'metrics') {
    result = await handleMetrics({ decision });
    log(result.wrote ? `评测已写入：${JSON.stringify(result.row)}` : `评测已存在，跳过（幂等）`);
  }

  await writeStepSummary(renderSummary({ decision, result, writeLevel }));
  return 0; // noop / inbox-only / metrics / 已完成的 run 都是成功退出
}

main()
  .then((code) => process.exit(code))
  .catch(async (e) => {
    console.error(`[loop] error: ${e?.stack ?? e}`);
    await writeStepSummary(`## Loop — FAILED\n\n\`\`\`\n${e?.message ?? e}\n\`\`\`\n`).catch(() => {});
    process.exit(1);
  });
