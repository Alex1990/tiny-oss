/**
 * tiny-oss Loop 状态层原语 —— 本地宿主 `run.mjs` 与 Actions 编排 `run-stage.mjs` 共用。
 *
 * 唯一写入者原则：两个入口都只经本模块读写 `state/`，避免两份实现漂移
 * （A0 期 #33 的 acceptance 漏行就是人手漂移的实例）。
 *
 * schema：任务文件 / run 行 / 锁 / SUMMARY 见 scripts/loop/README.md；
 * 状态机与双口径定义见 docs/agents/ops.md、docs/agents/triage-labels.md。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* ------------------------------------------------------------ 领域常量 */

/** 五角色标签（triage-labels.md）：互斥，禁止叠加矛盾角色。 */
export const ROLE_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];

/** outcome → 任务终态 + 应打标签（ops.md "Labels → task state"）。 */
export const OUTCOME_MAP = {
  'triaged':      { status: 'ready',         label: 'ready-for-agent' },
  'needs-info':   { status: 'waiting-info',  label: 'needs-info' },
  'needs-triage': { status: 'waiting-human', label: 'needs-triage' },
  'pr-opened':    { status: 'waiting-merge', label: 'ready-for-human' },
  'closed':       { status: 'closed',        label: null },
  'rejected':     { status: 'rejected',      label: null },
  'accepted':     { status: 'accepted',      label: null },
  'failed':       { status: 'waiting-human', label: 'needs-triage' },
  // 宿主扩展（不在 ops.md 的 outcome 表内）：provider/网络瞬时故障，
  // 任务应回到可领取态而不是灌进收件箱 —— 收件箱是给人看的（run 契约退出码 3）。
  'retry':        { status: 'ready',         label: 'ready-for-agent' },
};

/** stage → 允许的成功 outcome 白名单（D5 防呆）；未列出的 stage 全放行。 */
const COMMON_OUTCOMES = ['failed', 'rejected', 'accepted', 'retry'];
export const STAGE_OUTCOMES = {
  triage: ['triaged', 'needs-info', 'needs-triage', 'closed'],
  bugfix: ['pr-opened'],
  feature: ['pr-opened'],
  deps: ['pr-opened', 'needs-triage'],
  security: ['pr-opened', 'needs-triage'],
};

export function outcomeAllowed(stage, outcome) {
  const extra = STAGE_OUTCOMES[stage];
  if (!extra) return true;
  return COMMON_OUTCOMES.includes(outcome) || extra.includes(outcome);
}

export function allowedOutcomes(stage) {
  return [...COMMON_OUTCOMES, ...(STAGE_OUTCOMES[stage] ?? [])];
}

/* ---------------------------------------------------------------- 时钟 */

const pad = (n) => String(n).padStart(2, '0');

export const nowIso = () => new Date().toISOString();
export const rand4 = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

export const newRunId = () => {
  const d = new Date();
  return `r-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${rand4()}`;
};

/* ------------------------------------------------------------ 状态层路径 */

/**
 * 构造状态层句柄。`stateRoot` 默认 `<repoRoot>/state`，`STATE_DIR` 环境变量可覆盖
 * （runner 上锚定到 job 工作目录，本地锚定到仓库根）。
 */
export function makeState(repoRoot) {
  const root = process.env.STATE_DIR ? path.resolve(process.env.STATE_DIR) : path.join(repoRoot, 'state');
  const d = (k) => path.join(root, k);
  return {
    root,
    tasksDir: d('tasks'),
    runsDir: d('runs'),
    locksDir: d('locks'),
    metricsDir: d('metrics'),
    reportsDir: d('reports'),
    summaryFile: path.join(root, 'SUMMARY.md'),
    acceptanceFile: path.join(d('metrics'), 'acceptance.jsonl'),
    taskFile: (id) => path.join(d('tasks'), `${id}.json`),
    runFile: (rid) => path.join(d('runs'), `${rid}.jsonl`),
    lockFile: (id, stage) => path.join(d('locks'), `${id}-${stage}.lock`),
  };
}

export async function ensureDirs(s) {
  await Promise.all(
    [s.tasksDir, s.runsDir, s.locksDir, s.metricsDir, s.reportsDir]
      .map((p) => fs.mkdir(p, { recursive: true })),
  );
}

/* --------------------------------------------------------------- 文件 IO */

export async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function writeJson(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

export async function readJsonl(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw.trim() ? raw.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

async function appendJsonl(file, row) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, JSON.stringify(row) + '\n', 'utf8');
}

export const appendRunRow = (s, rid, row) => appendJsonl(s.runFile(rid), row);
export const readRunLines = (s, rid) => readJsonl(s.runFile(rid));

/* ------------------------------------------------------------ 任务操作 */

export async function listTasks(s) {
  const files = (await fs.readdir(s.tasksDir).catch(() => [])).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const t = await readJson(path.join(s.tasksDir, f));
    if (t) out.push(t);
  }
  return out;
}

export async function loadTask(s, id) {
  const t = await readJson(s.taskFile(id));
  if (!t) throw new Error(`task #${id} 不存在（${s.taskFile(id)}）`);
  return t;
}

export async function saveTask(s, t) {
  t.updatedAt = nowIso();
  await writeJson(s.taskFile(t.id), t);
}

/** 下一本地任务 id：数字文件名最大 +1；空目录从 9000 起（避开 GitHub 编号段）。 */
export async function nextTaskId(s) {
  const files = await fs.readdir(s.tasksDir).catch(() => []);
  const nums = files.map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
  return nums.length ? Math.max(...nums) + 1 : 9000;
}

/* ------------------------------------------------------------------ 锁 */

/** 全托管形态下互斥由 workflow `concurrency` 承担；锁文件退化为记录与防呆。 */
export const lockExpired = (lockedBy) =>
  !lockedBy || Date.now() - Date.parse(lockedBy.since) > (lockedBy.ttl || 3600) * 1000;

export async function acquireLock(s, t, stage, rid) {
  const at = nowIso();
  const lock = { runId: rid, taskId: t.id, since: at, ttl: 3600 };
  t.status = 'processing';
  t.stage = stage;
  t.lockedBy = lock;
  t.runs.push(rid);
  t.timeline.push({ at, event: 'claimed', by: rid, detail: `stage=${stage}` });
  await saveTask(s, t);
  await writeJson(s.lockFile(t.id, stage), lock);
}

export async function releaseLock(s, t, stage) {
  await fs.rm(s.lockFile(t.id, stage), { force: true });
}

/* -------------------------------------------------------------- 评测写入 */

const acceptanceKey = (r) => `${r.taskId}|${r.event}|${r.pr ?? ''}`;

/**
 * 追加一条评测事件；同 `taskId+event+pr` 已存在则跳过（幂等）。
 * 写入者 = workflow job（agent 不写）；sweep 补写带 `sweep-corrected`。
 * 返回 true 表示本次确实写入。
 */
export async function appendAcceptance(s, row) {
  const existing = await readJsonl(s.acceptanceFile);
  if (existing.some((r) => acceptanceKey(r) === acceptanceKey(row))) return false;
  await appendJsonl(s.acceptanceFile, row);
  return true;
}

/* -------------------------------------------------------------- SUMMARY */

export async function renderSummary(s) {
  const tasks = await listTasks(s);
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
  const when = (t) => (t.updatedAt ?? '').slice(0, 16).replace('T', ' ');

  sec('运行中', tasks.filter((t) => t.status === 'processing').map((t) => {
    const lk = t.lockedBy
      ? ` (locked ${t.lockedBy.runId}, TTL ${new Date(Date.parse(t.lockedBy.since) + t.lockedBy.ttl * 1000).toISOString().slice(11, 16)}Z)`
      : '';
    return `#${t.id} ${t.stage} — ${t.title}${lk}`;
  }));

  sec('待人工放行 (waiting-merge)', tasks.filter((t) => t.status === 'waiting-merge').map((t) => {
    const prs = t.prs?.length ? ` PR #${t.prs.join(', #')}` : '';
    return `#${t.id}${prs} — ${t.title}${tag(t)} (${when(t)})`;
  }));

  sec('收件箱 (waiting-human / waiting-info)',
    tasks.filter((t) => ['waiting-human', 'waiting-info'].includes(t.status))
      .map((t) => `#${t.id} — ${t.title}${tag(t)} (${when(t)})`));

  sec('待领取 (ready)', tasks.filter((t) => t.status === 'ready').map((t) => {
    const d = t.decision ? ` decision=${t.decision.verdict}/${t.decision.confidence}` : '';
    return `#${t.id} — ${t.title}${d} (${when(t)})`;
  }));

  const terminal = tasks.filter((t) => ['closed', 'accepted', 'rejected'].includes(t.status));
  if (terminal.length) {
    const c = (st) => terminal.filter((t) => t.status === st).length;
    L.push('## 终态计数', '');
    L.push(`closed=${c('closed')} accepted=${c('accepted')} rejected=${c('rejected')}`, '');
  }

  // 最近评测（metrics/acceptance.jsonl：workflow 写，agent 不写）
  const acc = (await readJsonl(s.acceptanceFile)).slice(-5);
  if (acc.length) {
    L.push('## 最近评测', '');
    for (const r of acc) {
      L.push(`- ${r.event} task #${r.taskId}${r.pr ? ` pr #${r.pr}` : ''} accepted=${r.accepted ?? '-'} (${r.writer ?? '?'})`);
    }
    L.push('');
  }

  // 近期 run 尾部（≤5 条，防超长）
  const runFiles = (await fs.readdir(s.runsDir).catch(() => []))
    .filter((f) => f.endsWith('.jsonl')).sort().slice(-5);
  if (runFiles.length) {
    L.push('## 近期 run', '');
    for (const f of runFiles) {
      const rid = f.slice(0, -'.jsonl'.length);
      const rows = (await readRunLines(s, rid)).filter((r) => ['start', 'end'].includes(r.event));
      const st = rows.find((r) => r.event === 'start');
      const en = rows.find((r) => r.event === 'end');
      if (st) L.push(`- ${rid} task #${st.taskId} ${st.stage}${en ? ` → ${en.outcome}` : ' (未收尾)'}`);
    }
    L.push('');
  }

  const summary = L.join('\n').split('\n').slice(0, 60).join('\n');
  await fs.writeFile(s.summaryFile, summary.trimEnd() + '\n', 'utf8');
}

/* ------------------------------------------------------------ GitHub 动作 */

export function ghRepoOf(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * 由 outcome 推导 GitHub 写动作清单 —— **纯函数，不触网**。
 *
 * report 模式只调用本函数并把 `describeActions` 的输出写进报告；
 * auto 模式（L2+ / 预演）才交给 `applyActions` 执行。
 * 这是"严格只报告"的唯一开关点：不调 apply 即不写 GitHub。
 */
export function planActions(t, outcome, { label, comment, note } = {}) {
  if (!t.url) return []; // 本地合成任务无 GitHub 目标
  if (outcome === 'retry') return []; // 未实际执行（故障/草稿），不该产生写动作建议
  const repo = ghRepoOf(t.url);
  if (!repo) return [];
  // PR 与 issue 是两个不同的 gh 子命令面：对 PR 编号调 `gh issue edit` 会失败。
  const gh = t.kind === 'pr' ? 'pr' : 'issue';
  const acts = [];
  const l = label ?? OUTCOME_MAP[outcome]?.label ?? null;
  if (l) acts.push({ kind: 'label', gh, repo, number: t.id, label: l, stripRoles: true });
  if (outcome === 'closed') {
    acts.push({ kind: 'close', gh, repo, number: t.id, body: comment ?? note ?? 'Closed by the loop.' });
  } else if (comment) {
    acts.push({ kind: 'comment', gh, repo, number: t.id, body: comment });
  }
  return acts;
}

/** 人读描述，供 report 模式的报告与 Step Summary 使用。 */
export function describeActions(actions) {
  return actions.map((a) => {
    if (a.kind === 'label') {
      return `label #${a.number}: +${a.label}${a.stripRoles ? ' (先移除其它五角色标签)' : ''}`;
    }
    if (a.kind === 'close') return `close #${a.number} (comment: ${firstLine(a.body)})`;
    return `comment #${a.number}: ${firstLine(a.body)}`;
  });
}

const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 120);

/** 执行写动作（仅 auto / 预演路径调用）。失败只 warn，不回滚本地状态。 */
export function applyActions(actions, { log = console.log, warn = console.warn } = {}) {
  const applied = [];
  for (const a of actions) {
    const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });
    const sub = a.gh ?? 'issue'; // PR 走 gh pr，issue 走 gh issue
    if (a.kind === 'label') {
      let stale = [];
      if (a.stripRoles) {
        const cur = gh([sub, 'view', String(a.number), '-R', a.repo, '--json', 'labels', '-q', '.labels[].name']);
        stale = cur.status === 0
          ? cur.stdout.trim().split('\n').filter(Boolean).filter((l) => ROLE_LABELS.includes(l) && l !== a.label)
          : [];
      }
      const args = [sub, 'edit', String(a.number), '-R', a.repo, '--add-label', a.label];
      for (const st of stale) args.push('--remove-label', st);
      const r = gh(args);
      if (r.status !== 0) warn(`[loop] warn: 打标 ${a.label} 失败: ${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} +label ${a.label}${stale.length ? `, -label ${stale.join(', ')}` : ''}`); applied.push(a); }
    } else if (a.kind === 'close') {
      const r = gh([sub, 'close', String(a.number), '-R', a.repo, '--comment', a.body]);
      if (r.status !== 0) warn(`[loop] warn: close #${a.number} 失败: ${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} closed with comment`); applied.push(a); }
    } else if (a.kind === 'comment') {
      const r = gh([sub, 'comment', String(a.number), '-R', a.repo, '--body', a.body]);
      if (r.status !== 0) warn(`[loop] warn: 评论 #${a.number} 失败: ${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} commented`); applied.push(a); }
    }
  }
  return applied;
}

/* ---------------------------------------------------------- run 生命周期 */

/** 领取任务并写 start 行，返回 runId。`task` 为 null 表示系统级 run（sweep/retro/release 预检）。 */
export async function beginRun(s, t, stage, { sandbox, trigger = 'manual', model = null } = {}) {
  const rid = newRunId();
  if (t) await acquireLock(s, t, stage, rid);
  await appendRunRow(s, rid, {
    runId: rid, taskId: t?.id ?? null, kind: t?.kind ?? null, stage,
    event: 'start', at: nowIso(), sandbox, model, trigger,
  });
  return rid;
}

/** report 模式：把待人工执行的写动作追加到该 run 的报告文件。 */
export async function appendActionBlock(s, runId, actions) {
  const file = path.join(s.reportsDir, `${runId}.md`);
  await fs.mkdir(s.reportsDir, { recursive: true });
  const block = [
    '', '## 待人工执行的 GitHub 动作（写边界=report）', '',
    ...describeActions(actions).map((d) => `- [ ] ${d}`), '',
  ].join('\n');
  await fs.appendFile(file, block, 'utf8');
  return file;
}

/**
 * 收尾一个 run：写 end 行 → 更新任务 → 释放锁 → GitHub 动作（report 只列出，auto 才执行）
 * → 刷新 SUMMARY。本地 CLI 与 runner 编排共用，保证幂等与白名单只有一份实现。
 */
export async function finishRun(s, {
  runId, outcome, note = null, comment = null, label = null, decision = null, pr = null,
  tokens = null, writeLevel = 'report', noGithub = false, log = () => {}, warn = () => {},
}) {
  if (!outcome || !OUTCOME_MAP[outcome]) {
    throw new Error(`outcome 必填且 ∈ {${Object.keys(OUTCOME_MAP).join(', ')}}`);
  }
  const rows = await readRunLines(s, runId);
  if (!rows.length) throw new Error(`run ${runId} 不存在（${s.runFile(runId)}）`);
  if (rows.some((r) => r.event === 'end')) throw new Error(`run ${runId} 已有 end 行，重复收尾被拒绝（幂等）`);
  const start = rows[0];
  // 系统级 run（sweep/retro/release 预检）无任务文件：只记 run 行，不做状态转移。
  const t = start.taskId ? await loadTask(s, start.taskId) : null;
  if (t && !outcomeAllowed(start.stage, outcome)) {
    throw new Error(`stage=${start.stage} 不允许 outcome=${outcome}（D5；允许: ${allowedOutcomes(start.stage).join(', ')}）`);
  }
  const at = nowIso();

  await appendRunRow(s, runId, {
    runId, event: 'end', at, outcome,
    durationMs: Date.now() - Date.parse(start.at),
    tokens: tokens ?? start.tokens ?? null, note, pr: pr ?? undefined, writeLevel,
  });

  if (!t) {
    await renderSummary(s);
    return { task: null, actions: [], applied: [] };
  }

  if (decision) {
    t.decision = typeof decision === 'string' ? JSON.parse(decision) : decision;
  }
  if (pr) {
    const n = Number(pr);
    if (!Number.isInteger(n) || n <= 0) throw new Error('pr 须为正整数');
    if (!t.prs.includes(n)) t.prs.push(n);
  }
  const m = OUTCOME_MAP[outcome];
  t.status = m.status;
  t.labels = m.label ? [m.label] : [];
  t.timeline.push({ at, event: 'ended', by: runId, detail: `outcome=${outcome}${note ? ` — ${note}` : ''}` });
  await saveTask(s, t);
  await releaseLock(s, t, t.stage);

  const actions = noGithub ? [] : planActions(t, outcome, { label: label ?? m.label, comment, note });
  let applied = [];
  if (actions.length) {
    if (writeLevel === 'auto') applied = applyActions(actions, { log, warn });
    else await appendActionBlock(s, runId, actions);
  }

  await renderSummary(s);
  return { task: t, actions, applied };
}

/* ------------------------------------------------------------------ CLI */

export function parseArgs(argv) {
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
