#!/usr/bin/env node
/**
 * tiny-oss Loop A0 本地手动宿主（自建形态最小适配）
 *
 * 目标：在本机手动试跑 Loop run 契约（[[tiny-oss-runtime]] §5），不依赖
 * GitHub Actions / R2。状态层布局 = memory §3.1（tasks/ runs/ locks/
 * metrics/ SUMMARY.md），位于仓库根 `state/`（已 gitignore）。
 *
 * 用法（Windows 与 POSIX 一致；`pnpm loop` = 本文件，见 package.json）：
 *   pnpm loop start  [--stage <triage|bugfix|feature|...>] [--task <n>]
 *                     [--new --title "..." --body "..."]   # 新建本地任务
 *                     [--issue <gh#>]                      # 导入 GitHub issue（需 gh，只读）
 *   pnpm loop checkpoint --run <runId> --note "..."
 *   pnpm loop end     --run <runId> --outcome <outcome> [--comment "..."] [--label <n>]
 *                      [--no-github]   # 或 --task <n> 反查未收尾 run（D2）
 *   pnpm loop summary | view [--run <runId> | --task <n>]
 *
 * outcome 取值与状态转移（ops.md Labels→task state）：
 *   triaged      → ready          + ready-for-agent    （triage 判 bug/feature）
 *   needs-info   → waiting-info   + needs-info
 *   needs-triage → waiting-human  + needs-triage       （cannot-handle/低置信/failed）
 *   pr-opened    → waiting-merge  + ready-for-human
 * D9（GitHub 重开转移）：start 领取时若本地任务为终态（closed/rejected）而 GitHub
 * issue 已重开为 OPEN，自动重置 ready + 清 decision + timeline 记 reopened 再领取，
 * 使 reopened 事件按 ops.md 触发映射回到 triage。
 * 远程写链路：真实 issue（有 url）收尾自动打标/评论/关闭（syncGithub）；
 * 本地合成任务自动跳过，--no-github 强制跳过。引擎(headless)自动跑是 A1+ 的事，
 * 本脚本只负责仪式（开场领取/过程记录/收尾回写）。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const STATE = process.env.STATE_DIR ? path.resolve(process.env.STATE_DIR) : path.join(ROOT, 'state');
const DIRS = { tasks: 'tasks', runs: 'runs', locks: 'locks', metrics: 'metrics' };

const nowIso = () => new Date().toISOString();
const rand4 = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');
const pad = (n) => String(n).padStart(2, '0');
const runId = () => {
  const d = new Date();
  return `r-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${rand4()}`;
};

async function ensureDirs() {
  await Promise.all(Object.values(DIRS).map((d) => fs.mkdir(path.join(STATE, d), { recursive: true })));
}
const dir = (k) => path.join(STATE, DIRS[k]);

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
async function writeJson(file, obj) {
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
async function appendRunRow(runIdVal, row) {
  const file = path.join(dir('runs'), `${runIdVal}.jsonl`);
  await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
}
async function readRunLines(runIdVal) {
  try {
    const raw = await fs.readFile(path.join(dir('runs'), `${runIdVal}.jsonl`), 'utf8');
    return raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
const taskFile = (id) => path.join(dir('tasks'), `${id}.json`);

function fail(msg) {
  console.error(`[loop] error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

/** 下一本地任务 id：数字文件名最大 +1；空目录从 9000 起（避开 GitHub 编号段）。 */
async function nextTaskId() {
  const files = await fs.readdir(dir('tasks'));
  const nums = files
    .map((f) => /^(\d+)\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .map(Number);
  return nums.length ? Math.max(...nums) + 1 : 9000;
}

async function loadTask(id) {
  const t = await readJson(taskFile(id));
  if (!t) fail(`task #${id} 不存在（state/tasks/${id}.json）`);
  return t;
}

async function saveTask(t) {
  t.updatedAt = nowIso();
  await writeJson(taskFile(t.id), t);
}

/* ---------------------------------------------------------------- start */

async function cmdStart(args) {
  const { stage, task, 'new': isNew, title, body, issue, url } = args;
  await ensureDirs();
  const s = stage ?? 'triage';
  if (!stage) console.log('[loop] --stage 缺省，默认 triage');

  let t;
  if (isNew || issue) {
    if (isNew && !title) fail('--new 需要 --title');
    let id;
    let extra = {};
    if (issue) {
      const gh = spawnSync('gh', ['issue', 'view', String(issue), '--json',
        'number,title,body,state,labels,url'], { encoding: 'utf8' });
      if (gh.status !== 0) fail(`gh issue view 失败（gh 未装或无认证？）：${(gh.stderr || '').trim()}`);
      const it = JSON.parse(gh.stdout);
      if (it.state !== 'OPEN') fail(`#${it.number} 状态=${it.state}，仅 OPEN 的 issue 可导入（D1）`);
      id = it.number;
      extra = { url: it.url };
      t = {
        id, kind: 'issue', title: it.title, url: it.url, body: it.body,
        status: 'new', stage: null, labels: (it.labels || []).map((l) => l.name),
        createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
        agentPlan: null, prs: [], runs: [], timeline: [],
      };
    } else {
      id = await nextTaskId();
      t = {
        id, kind: 'issue', title, url: url ?? null, body: body ?? '',
        status: 'new', stage: null, labels: [],
        createdAt: nowIso(), updatedAt: nowIso(), lockedBy: null, decision: null,
        agentPlan: null, prs: [], runs: [], timeline: [],
      };
      extra = { synthetic: true };
    }
    const file = taskFile(id);
    if (await readJson(file)) fail(`任务 #${id} 已存在，拒绝覆盖（${file}）；重跑 triage/处理请用 start --task ${id} [--stage <s>]（D3）`);
    t.timeline.push({ at: t.createdAt, event: 'created', by: 'manual', ...extra });
    await writeJson(file, t);
    console.log(`[loop] 任务 #${id} 已创建（${isNew ? '本地合成' : 'GitHub 导入'}）`);
  } else {
    t = await loadTask(task ?? fail('--task <n> 或 --new/--issue 必填'));
  }

  // 领取检查：new/ready/waiting-info 可领；processing 活锁拒领、死锁(TTL>1h)可覆盖；
  // 终态（closed/rejected）任务若 GitHub issue 已重开（OPEN）→ 自动重置为 ready 再领取（D9）
  const claimable = ['new', 'ready', 'waiting-info'];
  if (t.status === 'processing') {
    const lk = t.lockedBy;
    const dead = lk && Date.now() - Date.parse(lk.since) > (lk.ttl || 3600) * 1000;
    if (!dead) fail(`任务 #${t.id} 被 ${lk?.runId ?? '?'} 持有（status=processing），请先结束或等 TTL 过期`);
    console.warn(`[loop] warn: 任务 #${t.id} 的锁已过期（${lk?.runId}），本次接管续跑`);
  } else if (!claimable.includes(t.status) && t.url) {
    const repo = ghRepoOf(t.url);
    const ghState = repo
      ? spawnSync('gh', ['issue', 'view', String(t.id), '-R', repo, '--json', 'state', '-q', '.state'], { encoding: 'utf8' })
      : null;
    const ghOpen = ghState && ghState.status === 0 && ghState.stdout.trim() === 'OPEN';
    if (ghOpen) {
      console.warn(`[loop] warn: 任务 #${t.id} 本地 status=${t.status}，GitHub issue 已重开（OPEN）→ 重置为 ready 后领取（D9）`);
      t.status = 'ready';
      t.decision = null;
      t.timeline.push({ at: nowIso(), event: 'reopened', by: 'github', detail: 'GitHub issue 重开 → 终态重置为 ready（D9）' });
    }
  }
  if (!claimable.includes(t.status)) {
    fail(`任务 #${t.id} status=${t.status} 不可领取（可领: ${claimable.join('/')}；GitHub 已重开的终态任务会自动放行）`);
  }

  const rid = runId();
  const at = nowIso();
  t.status = 'processing';
  t.stage = s;
  t.lockedBy = { runId: rid, since: at, ttl: 3600 };
  t.runs.push(rid);
  t.timeline.push({ at, event: 'claimed', by: rid, detail: `stage=${s}` });
  await saveTask(t);
  await fs.writeFile(path.join(dir('locks'), `${t.id}-${s}.lock`),
    JSON.stringify({ runId: rid, taskId: t.id, since: at, ttl: 3600 }, null, 2) + '\n', 'utf8');
  await appendRunRow(rid, {
    runId: rid, taskId: t.id, kind: t.kind, stage: s,
    event: 'start', at, sandbox: `local:${process.platform}`, model: null, trigger: 'manual',
  });

  console.log(`[loop] run 开始: ${rid}`);
  console.log(`[loop] task #${t.id}（stage=${s}）已领取 → state/tasks/${t.id}.json`);
  console.log('[loop] 开场仪式：先读 AGENTS.md → docs/agents/ops.md → 对应 skill:');
  const skillFile = path.join(ROOT, 'skills', s, 'SKILL.md');
  try {
    await fs.access(skillFile);
    console.log(`[loop]              skills/${s}/SKILL.md`);
  } catch {
    console.log(`[loop]              skills/${s}/SKILL.md 不存在（该 stage 无专属 skill；流程用到 verify/review 时读对应 SKILL.md）`);
  }
  console.log('[loop] 过程可记 checkpoint；完成后执行:');
  console.log(`  pnpm loop end --run ${rid} --outcome <triaged|needs-info|needs-triage|pr-opened|closed|rejected|accepted|failed> [--comment "..."] [--note "..."]`);
}

/* --------------------------------------------------------------- end */

const OUTCOME_MAP = {
  'triaged':      { status: 'ready',          label: 'ready-for-agent' },
  'needs-info':   { status: 'waiting-info',   label: 'needs-info' },
  'needs-triage': { status: 'waiting-human',  label: 'needs-triage' },
  'pr-opened':    { status: 'waiting-merge',  label: 'ready-for-human' },
  'closed':       { status: 'closed',         label: null },
  'rejected':     { status: 'rejected',       label: null },
  'accepted':     { status: 'accepted',       label: null },
  'failed':       { status: 'waiting-human',  label: 'needs-triage' },
};

/* stage → 允许的成功 outcome 白名单（D5 防呆）；未列出的 stage 全放行 */
const COMMON_OUTCOMES = ['failed', 'rejected', 'accepted'];
const STAGE_OUTCOMES = {
  triage: ['triaged', 'needs-info', 'needs-triage', 'closed'],
  bugfix: ['pr-opened'],
  feature: ['pr-opened'],
  deps: ['pr-opened', 'needs-triage'],
  security: ['pr-opened', 'needs-triage'],
};
function outcomeAllowed(stage, outcome) {
  const extra = STAGE_OUTCOMES[stage];
  if (!extra) return true;
  return COMMON_OUTCOMES.includes(outcome) || extra.includes(outcome);
}

async function cmdEnd(args) {

  const { run, task, outcome, note, comment, label, decision, pr, 'no-github': noGithub } = args;
  let rid = run;
  if (!rid) {
    // D2：--task <n> 反查该任务未收尾的 run
    if (!task) fail('--run <runId> 或 --task <n>（反查未收尾 run）必填');
    const t0 = await loadTask(task);
    const open = [];
    for (const r of [...t0.runs].reverse()) {
      const ls = await readRunLines(r);
      if (ls.length && !ls.some((l) => l.event === 'end')) open.push(r);
    }
    if (!open.length) fail(`任务 #${task} 无未收尾的 run`);
    if (open.length > 1) fail(`任务 #${task} 有多个未收尾 run（${open.join(', ')}），请用 --run 指定`);
    rid = open[0];
    console.log(`[loop] 反查到未收尾 run: ${rid}`);
  }
  if (!outcome || !OUTCOME_MAP[outcome]) {
    fail(`--outcome 必填且 ∈ {${Object.keys(OUTCOME_MAP).join(', ')}}`);
  }
  const lines = await readRunLines(rid);
  if (!lines.length) fail(`run ${rid} 不存在（state/runs/${rid}.jsonl）`);
  if (lines.some((l) => l.event === 'end')) fail(`run ${rid} 已有 end 行，重复收尾被拒绝（幂等）`);
  const start = lines[0];
  if (!outcomeAllowed(start.stage, outcome)) {
    fail(`stage=${start.stage} 不允许 outcome=${outcome}（D5；该 stage 允许: ${[...COMMON_OUTCOMES, ...(STAGE_OUTCOMES[start.stage] ?? [])].join(', ')}）`);
  }
  const t = await loadTask(start.taskId);
  const at = nowIso();
  const durationMs = Date.now() - Date.parse(start.at);
  const m = OUTCOME_MAP[outcome];

  await appendRunRow(rid, { runId: rid, event: 'end', at, outcome, durationMs, tokens: null, note: note ?? null, pr: pr ?? undefined });

  if (decision) {
    try {
      t.decision = JSON.parse(decision);
    } catch {
      fail(`--decision 须为 JSON，如 '{"verdict":"feature","confidence":"high","reason":"..."}'`);
    }
  }
  if (pr) {
    const n = Number(pr);
    if (!Number.isInteger(n) || n <= 0) fail(`--pr 须为 PR 编号数字`);
    if (!t.prs.includes(n)) t.prs.push(n);
  }
  t.status = m.status;
  t.labels = m.label ? [m.label] : [];
  t.timeline.push({ at, event: 'ended', by: rid, detail: `outcome=${outcome}${note ? ` — ${note}` : ''}` });
  await saveTask(t);
  const lockFile = path.join(dir('locks'), `${t.id}-${t.stage}.lock`);
  await fs.rm(lockFile, { force: true });
  console.log(`[loop] run ${rid} 收尾: outcome=${outcome}`);
  console.log(`[loop] task #${t.id} → status=${t.status}${m.label ? `, label=${m.label}` : ''}`);

  if (!noGithub) await syncGithub(t, outcome, { label: label ?? m.label, comment });
  await renderSummary();
  console.log('[loop] SUMMARY.md 已刷新');
}

/* GitHub 写同步：真实 issue 任务收尾时打标/评论/关闭（自动写链路）。
   本地合成任务（url 为空）自动跳过；gh 写失败只 warn，不回滚本地状态。 */

function ghRepoOf(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/\d+/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

async function syncGithub(t, outcome, { label, comment }) {
  if (!t.url) return; // 本地合成任务
  const repo = ghRepoOf(t.url);
  if (!repo) {
    console.warn(`[loop] warn: 无法从 url 解析 repo，跳过 GitHub 同步: ${t.url}`);
    return;
  }
  const gh = (a) => spawnSync('gh', a, { encoding: 'utf8' });
  if (label) {
    // 先移除其它五角色标签（triage-labels：禁止叠加矛盾角色），再打新标
    const ROLE_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];
    const cur = gh(['issue', 'view', String(t.id), '-R', repo, '--json', 'labels', '-q', '.labels[].name']);
    const stale = cur.status === 0
      ? cur.stdout.trim().split('\n').filter(Boolean).filter((l) => ROLE_LABELS.includes(l) && l !== label)
      : [];
    const a = ['issue', 'edit', String(t.id), '-R', repo, '--add-label', label];
    for (const s of stale) a.push('--remove-label', s);
    const r = gh(a);
    if (r.status !== 0) console.warn(`[loop] warn: 打标 ${label} 失败: ${(r.stderr || '').trim()}`);
    else console.log(`[loop] gh: #${t.id} +label ${label}${stale.length ? `, -label ${stale.join(', ')}` : ''}`);
  }
  if (outcome === 'closed') {
    const body = comment ?? note ?? 'Closed by the loop.';
    const r = gh(['issue', 'close', String(t.id), '-R', repo, '--comment', body]);
    if (r.status !== 0) console.warn(`[loop] warn: close #${t.id} 失败: ${(r.stderr || '').trim()}`);
    else console.log(`[loop] gh: #${t.id} closed with comment`);
  } else if (comment) {
    const r = gh(['issue', 'comment', String(t.id), '-R', repo, '--body', comment]);
    if (r.status !== 0) console.warn(`[loop] warn: 评论 #${t.id} 失败: ${(r.stderr || '').trim()}`);
    else console.log(`[loop] gh: #${t.id} commented`);
  }
}

/* ---------------------------------------------------------- checkpoint */

async function cmdCheckpoint(args) {
  const { run: rid, note } = args;
  if (!rid || !note) fail('--run <runId> --note "..." 必填');
  const lines = await readRunLines(rid);
  if (!lines.length) fail(`run ${rid} 不存在`);
  await appendRunRow(rid, { runId: rid, event: 'checkpoint', at: nowIso(), note });
  console.log(`[loop] run ${rid} checkpoint 已记录`);
}

/* ------------------------------------------------------------- summary */

async function renderSummary() {
  const files = (await fs.readdir(dir('tasks'))).filter((f) => f.endsWith('.json'));
  const tasks = [];
  for (const f of files) {
    const t = await readJson(path.join(dir('tasks'), f));
    if (t) tasks.push(t);
  }
  const L = [];
  L.push(`# Loop 状态摘要 (updated ${nowIso()})`);
  L.push('');
  const sec = (title, rows) => {
    if (!rows.length) return;
    L.push(`## ${title}`, '');
    for (const r of rows) L.push(`- ${r}`);
    L.push('');
  };
  const tag = (t) => (t.labels?.length ? ` [${t.labels.join(',')}]` : '');
  const when = (t) => t.updatedAt.slice(0, 16).replace('T', ' ');

  const processing = tasks.filter((t) => t.status === 'processing');
  sec('运行中', processing.map((t) => {
    const lk = t.lockedBy ? ` (locked ${t.lockedBy.runId}, TTL ${new Date(Date.parse(t.lockedBy.since) + t.lockedBy.ttl * 1000).toISOString().slice(11, 16)}Z)` : '';
    return `#${t.id} ${t.stage} — ${t.title}${lk}`;
  }));

  const wm = tasks.filter((t) => t.status === 'waiting-merge');
  sec('待人工放行 (waiting-merge)', wm.map((t) => {
    const prs = t.prs?.length ? ` PR #${t.prs.join(', #')}` : '';
    return `#${t.id}${prs} — ${t.title}${tag(t)} (${when(t)})`;
  }));

  const inbox = tasks.filter((t) => ['waiting-human', 'waiting-info'].includes(t.status));
  sec('收件箱 (waiting-human / waiting-info)', inbox.map((t) =>
    `#${t.id} — ${t.title}${tag(t)} (${when(t)})`));

  const ready = tasks.filter((t) => t.status === 'ready');
  sec('待领取 (ready)', ready.map((t) => {
    const d = t.decision ? ` decision=${t.decision.verdict}/${t.decision.confidence}` : '';
    return `#${t.id} — ${t.title}${d} (${when(t)})`;
  }));

  const terminal = tasks.filter((t) => ['closed', 'accepted', 'rejected'].includes(t.status));
  if (terminal.length) {
    const c = (s) => terminal.filter((t) => t.status === s).length;
    L.push('## 终态计数', '');
    L.push(`closed=${c('closed')} accepted=${c('accepted')} rejected=${c('rejected')}`, '');
  }

  // 最近评测（acceptance.jsonl，agent 不写；sweep/workflow 写）
  try {
    const raw = await fs.readFile(path.join(dir('metrics'), 'acceptance.jsonl'), 'utf8');
    const rows = raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).slice(-5);
    if (rows.length) {
      L.push('## 最近评测', '');
      for (const r of rows) L.push(`- ${r.event} task #${r.taskId}${r.pr ? ` pr #${r.pr}` : ''} accepted=${r.accepted ?? '-'} (${r.writer ?? '?'})`);
      L.push('');
    }
  } catch { /* 文件不存在=尚无评测，省略 */ }

  // 近期 run 尾部（≤5 行，防超长）
  const runFiles = (await fs.readdir(dir('runs'))).filter((f) => f.endsWith('.jsonl')).sort().slice(-5);
  if (runFiles.length) {
    L.push('## 近期 run', '');
    for (const f of runFiles) {
      const lines = (await readRunLines(f.slice(0, -6))).filter((r) => ['start', 'end'].includes(r.event));
      const s = lines.find((r) => r.event === 'start');
      const e = lines.find((r) => r.event === 'end');
      if (s) L.push(`- ${f.slice(0, -6)} task #${s.taskId} ${s.stage}${e ? ` → ${e.outcome}` : ' (未收尾)'}`);
    }
    L.push('');
  }

  const summary = L.join('\n').split('\n').slice(0, 60).join('\n');
  await fs.writeFile(path.join(STATE, 'SUMMARY.md'), summary.trimEnd() + '\n', 'utf8');
}

/* ---------------------------------------------------------------- view */

async function cmdView(args) {
  const { run: rid, task } = args;
  if (rid) {
    const lines = await readRunLines(rid);
    if (!lines.length) fail(`run ${rid} 不存在`);
    for (const l of lines) console.log(JSON.stringify(l, null, 2));
    return;
  }
  if (task) {
    console.log(JSON.stringify(await loadTask(task), null, 2));
    return;
  }
  const files = (await fs.readdir(dir('tasks'))).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    const t = await readJson(path.join(dir('tasks'), f));
    if (t) console.log(`#${t.id}\t${t.status}\t${t.stage ?? '-'}\t${(t.labels || []).join(',')}\t${t.title}`);
  }
}

/* ----------------------------------------------------------------- main */

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`用法:
  pnpm loop start [--stage <stage>] --task <n>   # stage 缺省 triage
                  [--new --title ".." [--body ".."] | --issue <gh#>]
  pnpm loop checkpoint --run <runId> --note ".."
  pnpm loop end --run <runId> --outcome <outcome> [--note ".."] [--comment ".."]
       [--label <name>] [--no-github]    # 真实 issue 收尾自动打标；closed/comment 写入 issue
       # end 可省 --run：--task <n> 反查未收尾 run
  pnpm loop summary | view [--run <id>|--task <n>]
outcome: ${Object.keys(OUTCOME_MAP).join(' | ')}
state 根: ${STATE}（env STATE_DIR 可覆盖）`);
    return;
  }
  const args = parseArgs(argv.slice(1));
  await ensureDirs();
  if (cmd === 'start') return cmdStart(args);
  if (cmd === 'end') return cmdEnd(args);
  if (cmd === 'checkpoint') return cmdCheckpoint(args);
  if (cmd === 'summary') return renderSummary();
  if (cmd === 'view') return cmdView(args);
  fail(`未知子命令 ${cmd}（--help 查看用法）`);
}

await main();
