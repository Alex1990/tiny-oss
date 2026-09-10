/**
 * tiny-oss Loop state-layer primitives — shared by the local host `run.mjs` and
 * the Actions orchestrator `run-stage.mjs`.
 * Single-writer principle: both entry points touch `state/` only through this module,
 * so the two implementations cannot drift (#33 during A0 was manual drift).
 *
 * schema: task files / run rows / locks / SUMMARY — see scripts/loop/README.md;
 * state machine + dual metrics: docs/agents/ops.md, docs/agents/triage-labels.md.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/* ------------------------------------------------------------ domain constants */

/** Five canonical role labels (triage-labels.md): mutually exclusive, never stacked. */
export const ROLE_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix'];

/** outcome → task terminal status + label to apply (ops.md "Labels → task state"). */
export const OUTCOME_MAP = {
  'triaged':      { status: 'ready',         label: 'ready-for-agent' },
  'needs-info':   { status: 'waiting-info',  label: 'needs-info' },
  'needs-triage': { status: 'waiting-human', label: 'needs-triage' },
  'pr-opened':    { status: 'waiting-merge', label: 'ready-for-human' },
  'closed':       { status: 'closed',        label: null },
  'rejected':     { status: 'rejected',      label: null },
  'accepted':     { status: 'accepted',      label: null },
  'failed':       { status: 'waiting-human', label: 'needs-triage' },
  // Host extension (not in the ops.md outcome table): transient provider/network
  // failures return the task to claimable, not the inbox (the inbox is for humans; exit 3).
  'retry':        { status: 'ready',         label: 'ready-for-agent' },
};

/** stage → whitelist of allowed successful outcomes (D5 guard); others allow all. */
const COMMON_OUTCOMES = ['failed', 'rejected', 'accepted', 'retry'];

/**
 * System-level run (sweep / retro / release precheck) outcomes — they only record
 * "how this round went" and map to no task status.
 *
 * Why task outcomes cannot be reused: `closed` means "closed outright, not part
 * of the acceptance denominator". A system-level run recording `closed` would
 * make retro count sweep/retro runs as closed tasks, skewing the dual-metric.
 */
export const SYSTEM_OUTCOMES = ['completed', 'failed', 'retry', 'aborted'];

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

/* ---------------------------------------------------------------- clock */

const pad = (n) => String(n).padStart(2, '0');

export const nowIso = () => new Date().toISOString();
export const rand4 = () => Math.random().toString(36).slice(2, 6).padEnd(4, '0');

export const newRunId = () => {
  const d = new Date();
  return `r-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`
    + `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${rand4()}`;
};

/* ------------------------------------------------------------ state-layer paths */

/**
 * Build a state-layer handle. `stateRoot` defaults to `<repoRoot>/state`; override
 * it with `STATE_DIR` (job workdir on the runner, repo root locally).
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

/* --------------------------------------------------------------- file IO */

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

/* ------------------------------------------------------------ task operations */

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
  if (!t) throw new Error(`task #${id} not found (${s.taskFile(id)})`);
  return t;
}

export async function saveTask(s, t) {
  t.updatedAt = nowIso();
  await writeJson(s.taskFile(t.id), t);
}

/** Next local task id: max numeric filename + 1; empty dir starts at 9000 (skips GH ids). */
export async function nextTaskId(s) {
  const files = await fs.readdir(s.tasksDir).catch(() => []);
  const nums = files.map((f) => /^(\d+)\.json$/.exec(f)?.[1]).filter(Boolean).map(Number);
  return nums.length ? Math.max(...nums) + 1 : 9000;
}

/* ------------------------------------------------------------------ locks */

/**
 * In the fully-hosted form, mutual exclusion comes from the workflow `concurrency`;
 * the lock file degrades to a record and a guard.
 */
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

/* -------------------------------------------------------------- acceptance writes */

const acceptanceKey = (r) => `${r.taskId}|${r.event}|${r.pr ?? ''}`;

/**
 * Append an acceptance event; skipped when the same `taskId+event+pr` already
 * exists (idempotent). Writer = the workflow job (agents never write); sweep
 * corrections carry `sweep-corrected`. Returns true when a row was actually written.
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
  L.push(`# Loop state summary (updated ${nowIso()})`);
  L.push('');
  const sec = (title, rows) => {
    if (!rows.length) return;
    L.push(`## ${title}`, '');
    for (const r of rows) L.push(`- ${r}`);
    L.push('');
  };
  const tag = (t) => (t.labels?.length ? ` [${t.labels.join(',')}]` : '');
  const when = (t) => (t.updatedAt ?? '').slice(0, 16).replace('T', ' ');

  sec('In progress', tasks.filter((t) => t.status === 'processing').map((t) => {
    const lk = t.lockedBy
      ? ` (locked ${t.lockedBy.runId}, TTL ${new Date(Date.parse(t.lockedBy.since) + t.lockedBy.ttl * 1000).toISOString().slice(11, 16)}Z)`
      : '';
    return `#${t.id} ${t.stage} — ${t.title}${lk}`;
  }));

  sec('Awaiting human merge (waiting-merge)',
    tasks.filter((t) => t.status === 'waiting-merge').map((t) => {
    const prs = t.prs?.length ? ` PR #${t.prs.join(', #')}` : '';
    return `#${t.id}${prs} — ${t.title}${tag(t)} (${when(t)})`;
  }));

  sec('Inbox (waiting-human / waiting-info)',
    tasks.filter((t) => ['waiting-human', 'waiting-info'].includes(t.status))
      .map((t) => `#${t.id} — ${t.title}${tag(t)} (${when(t)})`));

  sec('Ready to claim (ready)', tasks.filter((t) => t.status === 'ready').map((t) => {
    const d = t.decision ? ` decision=${t.decision.verdict}/${t.decision.confidence}` : '';
    return `#${t.id} — ${t.title}${d} (${when(t)})`;
  }));

  // `new` = the event is stored but not yet triaged. Easiest for humans to miss,
  // so it must appear in the summary (tasks just filed by sweep are this kind).
  sec('Unprocessed (new)', tasks.filter((t) => t.status === 'new').map((t) => {
    const kind = t.kind === 'pr' ? 'PR' : 'issue';
    return `#${t.id} (${kind}) — ${t.title} (${when(t)})`;
  }));

  const terminal = tasks.filter((t) => ['closed', 'accepted', 'rejected'].includes(t.status));
  if (terminal.length) {
    const c = (st) => terminal.filter((t) => t.status === st).length;
    L.push('## Terminal counts', '');
    L.push(`closed=${c('closed')} accepted=${c('accepted')} rejected=${c('rejected')}`, '');
  }

  // Recent acceptance (metrics/acceptance.jsonl: written by the workflow, not agents)
  const acc = (await readJsonl(s.acceptanceFile)).slice(-5);
  if (acc.length) {
    L.push('## Recent acceptance', '');
    for (const r of acc) {
      L.push(`- ${r.event} task #${r.taskId}${r.pr ? ` pr #${r.pr}` : ''} accepted=${r.accepted ?? '-'} (${r.writer ?? '?'})`);
    }
    L.push('');
  }

  // Tail of recent runs (<= 5, to keep the file short)
  const runFiles = (await fs.readdir(s.runsDir).catch(() => []))
    .filter((f) => f.endsWith('.jsonl')).sort().slice(-5);
  if (runFiles.length) {
    L.push('## Recent runs', '');
    for (const f of runFiles) {
      const rid = f.slice(0, -'.jsonl'.length);
      const rows = (await readRunLines(s, rid)).filter((r) => ['start', 'end'].includes(r.event));
      const st = rows.find((r) => r.event === 'start');
      const en = rows.find((r) => r.event === 'end');
      // System-level run (sweep / retro / release precheck) has no taskId
      if (st) {
        const what = st.taskId ? `task #${st.taskId}` : 'system';
        L.push(`- ${rid} ${what} ${st.stage}${en ? ` → ${en.outcome}` : ' (unfinished)'}`);
      }
    }
    L.push('');
  }

  const summary = L.join('\n').split('\n').slice(0, 60).join('\n');
  await fs.writeFile(s.summaryFile, summary.trimEnd() + '\n', 'utf8');
}

/* ------------------------------------------------------------ GitHub actions */

export function ghRepoOf(url) {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/\d+/.exec(url ?? '');
  return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * Derive the GitHub write-action list from the outcome — **pure function, never
 * touches the network**.
 * report mode only calls this function and writes `describeActions` output into the
 * report; auto mode (L2+ / dry run) hands it to `applyActions` — the one "report
 * only" switch: no apply, no GitHub writes.
 */
export function planActions(t, outcome, { label, comment, note } = {}) {
  if (!t.url) return []; // a local synthetic task has no GitHub target
  if (outcome === 'retry') return []; // nothing actually ran (failure/draft), so no write actions
  const repo = ghRepoOf(t.url);
  if (!repo) return [];
  // PR and issue are different gh subcommand surfaces: `gh issue edit` on a PR number fails.
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

/** Human-readable description, used by report-mode reports and the Step Summary. */
export function describeActions(actions) {
  return actions.map((a) => {
    if (a.kind === 'label') {
      return `label #${a.number}: +${a.label}${a.stripRoles ? ' (remove other role labels)' : ''}`;
    }
    if (a.kind === 'close') return `close #${a.number} (comment: ${firstLine(a.body)})`;
    return `comment #${a.number}: ${firstLine(a.body)}`;
  });
}

const firstLine = (s) => String(s ?? '').split('\n')[0].slice(0, 120);

/**
 * Execute write actions (only called on the auto / dry-run path). Failures only
 * warn; local state is never rolled back.
 */
export function applyActions(actions, { log = console.log, warn = console.warn } = {}) {
  const applied = [];
  for (const a of actions) {
    const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });
    const sub = a.gh ?? 'issue'; // PRs go to gh pr, issues to gh issue
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
      if (r.status !== 0) warn(`[loop] warn: label ${a.label} failed: ${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} +label ${a.label}${stale.length ? `, -label ${stale.join(', ')}` : ''}`); applied.push(a); }
    } else if (a.kind === 'close') {
      const r = gh([sub, 'close', String(a.number), '-R', a.repo, '--comment', a.body]);
      if (r.status !== 0) warn(`[loop] warn: close #${a.number} failed: `
        + `${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} closed with comment`); applied.push(a); }
    } else if (a.kind === 'comment') {
      const r = gh([sub, 'comment', String(a.number), '-R', a.repo, '--body', a.body]);
      if (r.status !== 0) warn(`[loop] warn: comment #${a.number} failed: `
        + `${(r.stderr || '').trim()}`);
      else { log(`[loop] gh: #${a.number} commented`); applied.push(a); }
    }
  }
  return applied;
}

/* ---------------------------------------------------------- run lifecycle */

/**
 * Claim a task and write the start row, returning the runId. `task` = null means a
 * system-level run (sweep / retro / release precheck).
 */
export async function beginRun(s, t, stage, { sandbox, trigger = 'manual', model = null } = {}) {
  const rid = newRunId();
  if (t) await acquireLock(s, t, stage, rid);
  await appendRunRow(s, rid, {
    runId: rid, taskId: t?.id ?? null, kind: t?.kind ?? null, stage,
    event: 'start', at: nowIso(), sandbox, model, trigger,
  });
  return rid;
}

/** report mode: append pending human write actions to this run's report file. */
export async function appendActionBlock(s, runId, actions) {
  const file = path.join(s.reportsDir, `${runId}.md`);
  await fs.mkdir(s.reportsDir, { recursive: true });
  const block = [
    '', '## Pending GitHub actions (write level=report)', '',
    ...describeActions(actions).map((d) => `- [ ] ${d}`), '',
  ].join('\n');
  await fs.appendFile(file, block, 'utf8');
  return file;
}

/**
 * Finish a run: write the end row → update the task → release the lock → GitHub
 * actions (report lists only, auto executes) → refresh SUMMARY. Shared by the local
 * CLI and the runner orchestrator, so idempotency and the whitelist have one home.
 */
export async function finishRun(s, {
  runId, outcome, note = null, comment = null, label = null, decision = null, pr = null,
  tokens = null, writeLevel = 'report', noGithub = false, log = () => {}, warn = () => {},
}) {
  if (!outcome) throw new Error('outcome is required');
  const rows = await readRunLines(s, runId);
  if (!rows.length) throw new Error(`run ${runId} not found (${s.runFile(runId)})`);
  if (rows.some((r) => r.event === 'end')) throw new Error(
    `run ${runId} already has an end row; duplicate finish is rejected (idempotent)`,
  );
  const start = rows[0];
  // A system-level run (sweep/retro/release precheck) has no task file: it only
  // records the run row, no status transition, and no task outcome semantics (e.g. closed).
  const t = start.taskId ? await loadTask(s, start.taskId) : null;
  if (!t) {
    if (!SYSTEM_OUTCOMES.includes(outcome)) {
      throw new Error(`system-level run (no task) outcome must be in `
        + `{${SYSTEM_OUTCOMES.join(', ')}}, got ${outcome}; task outcome semantics `
        + `(e.g. closed) must not appear on a system-level run (dual-metric pollution)`);
    }
  } else {
    if (!OUTCOME_MAP[outcome]) {
      throw new Error(`outcome must be one of `
        + `{${Object.keys(OUTCOME_MAP).join(', ')}}, got ${outcome}`);
    }
    if (!outcomeAllowed(start.stage, outcome)) {
      throw new Error(`stage=${start.stage} disallows outcome=${outcome} (D5; `
        + `allowed: ${allowedOutcomes(start.stage).join(', ')})`);
    }
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
    if (!Number.isInteger(n) || n <= 0) throw new Error('pr must be a positive integer');
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
