#!/usr/bin/env node
/**
 * tiny-oss Loop 本地宿主（CLI）
 *
 * 状态层原语全部来自 `./lib/state.mjs`（与 runner 编排 run-stage.mjs 共用，
 * 保证单一实现）。本文件只负责人工驱动的命令行仪式。
 *
 * 用法（`pnpm loop` = 本文件，见 package.json）：
 *   pnpm loop start  [--stage <triage|bugfix|feature|...>] [--task <n>]
 *                     [--new --title "..." --body "..."]   # 新建本地合成任务
 *                     [--issue <gh#>]                      # 导入 GitHub issue（需 gh，只读）
 *   pnpm loop checkpoint --run <runId> --note "..."
 *   pnpm loop end     --run <runId> --outcome <outcome> [--comment "..."] [--label <n>]
 *                      [--task <n>]                        # 反查未收尾 run（D2）
 *   pnpm loop summary | view [--run <runId> | --task <n>]
 *
 * 写边界（--write-level | LOOP_WRITE_LEVEL，默认 report）：
 *   report  只写状态层 + 报告：GitHub 写动作仅以"待人工执行"清单呈现（A1 语义）
 *   auto    执行打标/评论/关闭（A0 已放权语义；升 L2 后为常态）
 *
 * outcome 取值与状态转移（ops.md "Labels → task state"）：
 *   triaged      → ready          + ready-for-agent
 *   needs-info   → waiting-info   + needs-info
 *   needs-triage → waiting-human  + needs-triage
 *   pr-opened    → waiting-merge  + ready-for-human
 *   closed       → closed          None
 *   rejected     → rejected        None
 *   accepted     → accepted        None
 *   failed       → waiting-human  + needs-triage
 *
 * D9：start 领取时若本地任务为终态（closed/rejected）而 GitHub issue 已重开为 OPEN，
 * 自动重置 ready + 清 decision + timeline 记 reopened 再领取，回 triage。
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
  if (!WRITE_LEVELS.includes(wl)) fail(`--write-level 须为 ${WRITE_LEVELS.join('|')}（当前: ${wl}）`);
  return wl;
}

/* ---------------------------------------------------------------- start */

async function cmdStart(args) {
  const { stage, task, 'new': isNew, title, body, issue, pr, url } = args;
  await ensureDirs(S);
  const s = stage ?? 'triage';
  if (!stage) console.log('[loop] --stage 缺省，默认 triage');

  let t;
  if (isNew || issue || pr) {
    if (isNew && !title) fail('--new 需要 --title');
    let id;
    let kind = 'issue';
    let extra = {};
    if (pr) {
      // PR 与 issue 共用 triage 面（issue-tracker.md）；kind 区分，编号空间相同。
      const gh = spawnSync('gh', ['pr', 'view', String(pr), '--json',
        'number,title,body,state,labels,url'], { encoding: 'utf8' });
      if (gh.status !== 0) fail(`gh pr view 失败（gh 未装或无认证？）：${(gh.stderr || '').trim()}`);
      const it = JSON.parse(gh.stdout);
      if (it.state !== 'OPEN') fail(`PR #${it.number} 状态=${it.state}，仅 OPEN 的 PR 可导入（D1）`);
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
      if (gh.status !== 0) fail(`gh issue view 失败（gh 未装或无认证？）：${(gh.stderr || '').trim()}`);
      const it = JSON.parse(gh.stdout);
      if (it.state !== 'OPEN') fail(`#${it.number} 状态=${it.state}，仅 OPEN 的 issue 可导入（D1）`);
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
      fail(`任务 #${id} 已存在，拒绝覆盖（${S.taskFile(id)}）；重跑请用 start --task ${id} [--stage <s>]（D3）`);
    }
    t.timeline.push({ at: t.createdAt, event: 'created', by: 'manual', ...extra });
    await writeJson(S.taskFile(id), t);
    console.log(`[loop] 任务 #${id} 已创建（${isNew ? '本地合成' : pr ? 'GitHub PR 导入' : 'GitHub 导入'}）`);
  } else {
    t = await loadTask(S, task ?? fail('--task <n> 或 --pr/--issue/--new 必填'));
  }

  // 领取检查：new/ready/waiting-info 可领；processing 活锁拒领、死锁可覆盖；
  // 终态任务而 GitHub issue 已重开 → 自动重置 ready 再领取（D9）
  const claimable = ['new', 'ready', 'waiting-info'];
  if (t.status === 'processing') {
    if (!lockExpired(t.lockedBy)) {
      fail(`任务 #${t.id} 被 ${t.lockedBy?.runId ?? '?'} 持有（status=processing），请先结束或等 TTL 过期`);
    }
    console.warn(`[loop] warn: 任务 #${t.id} 的锁已过期（${t.lockedBy?.runId}），本次接管续跑`);
  } else if (!claimable.includes(t.status) && t.url) {
    const repo = repoOf(t.url);
    const ghState = repo
      ? spawnSync('gh', ['issue', 'view', String(t.id), '-R', repo, '--json', 'state', '-q', '.state'], { encoding: 'utf8' })
      : null;
    if (ghState && ghState.status === 0 && ghState.stdout.trim() === 'OPEN') {
      console.warn(`[loop] warn: 任务 #${t.id} 本地 status=${t.status}，GitHub issue 已重开 → 重置为 ready（D9）`);
      t.status = 'ready';
      t.decision = null;
      t.timeline.push({ at: nowIso(), event: 'reopened', by: 'github', detail: 'GitHub issue 重开 → 终态重置为 ready（D9）' });
    }
  }
  if (!claimable.includes(t.status)) {
    fail(`任务 #${t.id} status=${t.status} 不可领取（可领: ${claimable.join('/')}；GitHub 已重开的终态任务会自动放行）`);
  }

  const rid = await beginRun(S, t, s, { sandbox: `local:${process.platform}`, trigger: 'manual' });

  console.log(`[loop] run 开始: ${rid}`);
  console.log(`[loop] task #${t.id}（stage=${s}）已领取 → ${path.relative(ROOT, S.taskFile(t.id))}`);
  console.log('[loop] 开场仪式：先读 AGENTS.md → docs/agents/ops.md → 对应 skill:');
  const skillFile = path.join(ROOT, 'skills', s, 'SKILL.md');
  const hasSkill = await fs.access(skillFile).then(() => true, () => false);
  console.log(hasSkill
    ? `[loop]              skills/${s}/SKILL.md`
    : `[loop]              skills/${s}/SKILL.md 不存在（该 stage 无专属 skill；用到 verify/review 时读对应 SKILL.md）`);
  console.log(`[loop] 写边界: ${resolveWriteLevel(args)}（report = 只写状态层与报告，GitHub 写动作仅列出）`);
  console.log('[loop] 过程可记 checkpoint；完成后执行:');
  console.log(`  pnpm loop end --run ${rid} --outcome <${Object.keys(OUTCOME_MAP).join('|')}> [--comment "..."] [--note "..."]`);
}

/* ------------------------------------------------------------------ end */

async function cmdEnd(args) {
  const { run, task, outcome, note, comment, label, decision, pr, 'no-github': noGithub } = args;
  const wl = resolveWriteLevel(args);
  let rid = run;
  if (!rid) {
    if (!task) fail('--run <runId> 或 --task <n>（反查未收尾 run）必填');
    const t0 = await loadTask(S, task);
    const open = [];
    for (const r of [...t0.runs].reverse()) {
      const ls = await readRunLines(S, r);
      if (ls.length && !ls.some((l) => l.event === 'end')) open.push(r);
    }
    if (!open.length) fail(`任务 #${task} 无未收尾的 run`);
    if (open.length > 1) fail(`任务 #${task} 有多个未收尾 run（${open.join(', ')}），请用 --run 指定`);
    rid = open[0];
    console.log(`[loop] 反查到未收尾 run: ${rid}`);
  }
  try {
    const { task: t, actions, applied } = await finishRun(S, {
      runId: rid, outcome, note, comment, label, decision, pr,
      writeLevel: wl, noGithub,
      log: console.log, warn: console.warn,
    });
    const m = OUTCOME_MAP[outcome];
    console.log(`[loop] run ${rid} 收尾: outcome=${outcome}`);
    console.log(`[loop] task #${t.id} → status=${t.status}${m.label ? `, label=${m.label}` : ''}`);
    if (actions.length) {
      if (wl === 'auto') {
        console.log(`[loop] GitHub 写动作已执行 ${applied.length}/${actions.length} 项`);
      } else {
        console.log('[loop] 写边界=report：以下 GitHub 动作待人工执行');
        for (const d of describeActions(actions)) console.log(`  - ${d}`);
        console.log(`[loop] 已追加到报告: ${path.relative(ROOT, path.join(S.reportsDir, `${rid}.md`))}`);
      }
    } else if (noGithub) {
      console.log('[loop] --no-github：跳过 GitHub 写动作');
    }
    console.log('[loop] SUMMARY.md 已刷新');
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
  if (!rid || !note) fail('--run <runId> --note "..." 必填');
  const rows = await readRunLines(S, rid);
  if (!rows.length) fail(`run ${rid} 不存在`);
  await appendRunRow(S, rid, { runId: rid, event: 'checkpoint', at: nowIso(), note });
  console.log(`[loop] run ${rid} checkpoint 已记录`);
}

/* ---------------------------------------------------------------- view */

async function cmdView(args) {
  const { run: rid, task } = args;
  if (rid) {
    const rows = await readRunLines(S, rid);
    if (!rows.length) fail(`run ${rid} 不存在`);
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
    console.log(`用法:
  pnpm loop start [--stage <stage>] --task <n>   # stage 缺省 triage
                  [--pr <n> | --issue <gh#> | --new --title ".." [--body ".."]]
  pnpm loop checkpoint --run <runId> --note ".."
  pnpm loop end --run <runId> --outcome <outcome> [--note ".."] [--comment ".."]
       [--label <name>] [--no-github] [--task <n>]
       [--write-level report|auto]   # 默认 report：GitHub 写动作仅列出
  pnpm loop summary | view [--run <id>|--task <n>]
outcome: ${Object.keys(OUTCOME_MAP).join(' | ')}
state 根: ${S.root}（env STATE_DIR 可覆盖）
写边界: LOOP_WRITE_LEVEL=report|auto（默认 report）`);
    return;
  }
  const args = parseArgs(argv.slice(1));
  await ensureDirs(S);
  if (cmd === 'start') return cmdStart(args);
  if (cmd === 'end') return cmdEnd(args);
  if (cmd === 'checkpoint') return cmdCheckpoint(args);
  if (cmd === 'summary') return renderSummary(S);
  if (cmd === 'view') return cmdView(args);
  fail(`未知子命令 ${cmd}（--help 查看用法）`);
}

await main();
