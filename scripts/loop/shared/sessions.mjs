/**
 * Session mining — turn the uploaded `loop-sessions-<run_id>` artifacts into evidence.
 *
 * The workflow saves every agent session to an artifact (90 days) but, until this
 * module, nothing read them back: `retro` aggregated the run `end` rows only, so the
 * facts that explain a run — engine faults, failing tool calls, retry loops, reads of
 * skills that do not exist — were written and never consumed (#77).
 *
 * This module is deliberately dependency-free and side-effect-free so it can be
 * unit-tested in the repo's browser vitest environment: `sessions.mjs` (the CLI) does
 * the `gh`/`unzip`/filesystem work and calls `parseSessionText` → `aggregate` →
 * `renderMarkdown`.
 *
 * pi session format (v3, verified first-hand): one JSON object per line.
 *   - `{type:'session', ...}` starts the file;
 *   - `{type:'model_change'|'thinking_level_change'}` are metadata;
 *   - `{type:'message', timestamp, message:{role,...}}` holds user / assistant /
 *     toolResult messages. Assistant messages carry `usage` (per-call) and
 *     `stopReason`; tool calls are content items of type `toolCall`, their results
 *     arrive as `toolResult` messages with `toolCallId`, `toolName`, `isError`.
 *
 * Token accounting, the reason this module exists at all: the run `end` row stores the
 * *last* assistant call's `usage.totalTokens` (the final context size), because
 * `summarize()` treats the final `message_end` as authoritative. Summing every
 * assistant call's `totalTokens` instead yields the tokens actually processed. The two
 * differ by an order of magnitude over a session, which is why a "cost" attribution
 * that only reads end rows is wrong.
 */

/** Per-tool failure classes, most specific first. */
export const FAILURE_RULES = [
  {
    category: 'missing-skill',
    // The opening ritual points at `skills/<stage>/SKILL.md`; for stages without one
    // (feature, pr-review) every run burns a turn discovering that. High-signal
    // prompt/norms gap, so it gets its own class instead of hiding in `path-missing`.
    // Narrow on purpose: the ENOENT must be *about* the skill file (pi's read tool
    // emits `ENOENT ... access '<path>.md'`) and it must start a line, so a run that
    // merely reads a report or a test fixture quoting this text is not a failure.
    test: (t, toolName) => !['bash', 'sh', 'shell'].includes(String(toolName ?? '').toLowerCase())
      && /(^|\n)ENOENT: no such file or directory, access '[^']*SKILL\.md'/i.test(t),
  },
  {
    category: 'edit-mismatch',
    test: (t) => /(^|\n)(Could not find edits|edits?\[\d+\] and edits?\[\d+\] overlap|oldText must match)/i.test(t),
  },
  {
    category: 'gh-field',
    // Anchored at a line start: an agent may `cat` a report that *quotes* this text, and
    // a substring match would then turn a successful read into a phantom failure.
    test: (t) => /(^|\n)Unknown JSON field:/i.test(t),
  },
  {
    category: 'gh-flag',
    test: (t) => /(^|\n)(specify only one of|unknown flag|unknown shorthand flag|accepts \d+ arg)/i.test(t),
  },
  { category: 'git', test: (t) => /(^|\n)fatal:/i.test(t) },
  {
    category: 'path-missing',
    // File-tool misses only, and only the tool's own ENOENT line: a bash command that
    // prints ENOENT is a failing command, and file *content* may mention the string.
    test: (t, toolName) => /(^|\n)ENOENT: no such file or directory, (access|open|stat) '/.test(t)
      && !['bash', 'sh', 'shell'].includes(String(toolName ?? '').toLowerCase()),
  },
  { category: 'command-failed', test: (t) => /(^|\n)Command exited with code [1-9]\d*/i.test(t) },
  { category: 'tool-error', test: (_t, _tool, isError) => isError === true },
];

/** `text` content of a pi message, flattened. */
export function messageText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
    .filter(Boolean)
    .join('\n');
}

/** First user message — the loop prompt (carries stage / runId / task). */
function promptText(rows) {
  const first = rows.find((r) => r.type === 'message' && r.message?.role === 'user');
  return messageText(first?.message);
}

const oneLineRaw = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Secrets must not reach the report: the retro agent reads it and may quote it into a
 * proposal PR body, and tool errors routinely echo an env line. Patterns are the
 * credential shapes this repo's loop can actually hold, plus `NAME=value` pairs for
 * the names it uses.
 */
export const SECRET_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S+/g,
  /\b(?:R2|AWS|GH|GITHUB|DEEPSEEK)_[A-Z0-9_]*(?:ID|ACCOUNT)\s*[=:]\s*\S+/g,
];

/** Strip credential shapes before any text is stored or rendered. */
export function redact(s) {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, '[redacted]'), String(s ?? ''));
}

const oneLine = (s, max = 160) => redact(oneLineRaw(s)).slice(0, max);

/** Classify one failed tool result; `null` means "not a failure". */
export function classifyFailure(toolName, text, isError = false) {
  // A successful tool result is never a failure, however much failure *text* it
  // contains: an agent reading this very spec, a report, or a log quotes `ENOENT …
  // SKILL.md`, `fatal:`, `Command exited with code 1` and would otherwise fabricate
  // signals. Only the tool's own `isError` flag can open the content heuristics.
  if (isError !== true) return null;
  const t = String(text ?? '');
  for (const rule of FAILURE_RULES) {
    if (rule.test(t, toolName, isError)) return rule.category;
  }
  return null;
}

/** The human-relevant part of a tool call: the bash command, or the path it touched. */
function commandOf(call) {
  const a = call?.arguments ?? {};
  const raw = a.command ?? a.path ?? a.cmd ?? a.pattern ?? '';
  return oneLine(raw, 120);
}

/**
 * Parse one session file. `name` is only used for reporting.
 * Returns a flat signal record — no aggregation, no formatting.
 */
export function parseSessionText(text, name = 'session.jsonl') {
  const rows = [];
  for (const line of String(text ?? '').split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try {
      rows.push(JSON.parse(s));
    } catch {
      /* a torn last line (crash / timeout) must not discard the rest of the session */
    }
  }

  const prompt = promptText(rows);
  const stage = /Stage:\s*([\w-]+)/.exec(prompt)?.[1] ?? null;
  const runId = /runId:\s*`([^`]+)`/.exec(prompt)?.[1] ?? null;
  const taskMatch = /task:\s*#(\d+)/.exec(prompt);
  const taskId = taskMatch ? Number(taskMatch[1]) : null;

  const calls = new Map();
  const failures = [];
  const engineFaults = [];
  let billedTokens = 0;
  let contextTokens = 0;
  let costUsd = 0;
  let turns = 0;
  let toolCalls = 0;
  let model = null;
  let startedAt = null;
  let endedAt = null;

  const at = (row) => {
    const t = row?.message?.timestamp ?? row?.timestamp;
    const ms = typeof t === 'number' ? t : Date.parse(t);
    return Number.isFinite(ms) ? ms : null;
  };
  const span = (row) => {
    const ms = at(row);
    if (ms == null) return;
    if (startedAt == null || ms < startedAt) startedAt = ms;
    if (endedAt == null || ms > endedAt) endedAt = ms;
  };

  for (const row of rows) {
    span(row);
    if (row.type === 'model_change' && row.modelId) model = model ?? row.modelId;
    if (row.type !== 'message') continue;
    const msg = row.message ?? {};

    if (msg.role === 'assistant') {
      turns += 1;
      model = model ?? msg.model ?? null;
      const u = msg.usage ?? {};
      if (typeof u.totalTokens === 'number' && u.totalTokens > 0) {
        billedTokens += u.totalTokens;
        contextTokens = u.totalTokens; // last non-zero call = final context size
      }
      const cost = u.cost && typeof u.cost === 'object' ? u.cost.total : null;
      if (typeof cost === 'number') costUsd += cost;
      if (msg.stopReason === 'error' || msg.stopReason === 'aborted') {
        engineFaults.push({
          stopReason: msg.stopReason,
          message: oneLine(msg.errorMessage ?? msg.stopReason, 200),
          at: at(row),
        });
      }
      for (const part of Array.isArray(msg.content) ? msg.content : []) {
        if (part?.type !== 'toolCall') continue;
        toolCalls += 1;
        calls.set(part.id, { name: part.name, arguments: part.arguments });
      }
    } else if (msg.role === 'toolResult') {
      const body = messageText(msg);
      const category = classifyFailure(msg.toolName, body, msg.isError === true);
      if (!category) continue;
      const call = calls.get(msg.toolCallId);
      failures.push({
        category,
        tool: msg.toolName ?? call?.name ?? 'unknown',
        command: commandOf(call),
        detail: oneLine(body, 200),
        at: at(row),
      });
    }
  }

  return {
    name,
    runId,
    stage,
    taskId,
    model,
    startedAt: startedAt == null ? null : new Date(startedAt).toISOString(),
    endedAt: endedAt == null ? null : new Date(endedAt).toISOString(),
    durationMs: startedAt == null || endedAt == null ? null : endedAt - startedAt,
    turns,
    toolCalls,
    toolErrors: failures.length,
    billedTokens,
    contextTokens,
    costUsd,
    engineFaults,
    failures,
  };
}

/** Group a session's failures by (tool, command) so a retry loop is visible as one row. */
export function repeatedFailures(session) {
  const counts = new Map();
  for (const f of session.failures ?? []) {
    const key = `${f.tool}::${f.command || f.detail}`;
    const cur = counts.get(key) ?? { tool: f.tool, command: f.command, count: 0, categories: new Set() };
    cur.count += 1;
    cur.categories.add(f.category);
    counts.set(key, cur);
  }
  return [...counts.values()]
    .filter((c) => c.count >= 2)
    .map((c) => ({
      runId: session.runId, stage: session.stage, tool: c.tool, command: c.command,
      count: c.count, categories: [...c.categories],
    }))
    .sort((a, b) => b.count - a.count);
}

const median = (xs) => {
  const v = xs.filter((n) => typeof n === 'number').sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : Math.round((v[mid - 1] + v[mid]) / 2);
};

const sum = (xs, pick = (x) => x) => xs.reduce((n, x) => n + (pick(x) ?? 0), 0);

/** `end` rows for the distinct run ids that are present, in first-seen order. */
const uniqueEnds = (runIds, ends) => [...new Set(runIds.filter((id) => id && ends.has(id)))]
  .map((id) => ends.get(id));

/**
 * Aggregate parsed sessions. `runRows` are the state layer's run `end` rows
 * (`{runId, stage, outcome, tokens, durationMs}`); joining them by run id both
 * attributes outcomes and exposes how far the recorded `tokens` value is from the
 * tokens the session actually processed.
 */
export function aggregate(sessions, {
  runRows = [], generatedAt = new Date().toISOString(), artifacts = null, inputFiles = null,
} = {}) {
  const ends = new Map();
  for (const row of runRows) {
    if (row?.event === 'end' && row.runId) ends.set(row.runId, row);
  }

  const byStage = new Map();
  for (const s of sessions) {
    const stage = s.stage ?? 'unknown';
    const cur = byStage.get(stage) ?? { stage, sessions: [] };
    cur.sessions.push(s);
    byStage.set(stage, cur);
  }

  const stages = [...byStage.values()].map(({ stage, sessions: ss }) => {
    // One `end` row per *run*, not per session. `pr-review` runs two reviewers that share
    // a runId and whose row is already the sum over both (shared/review.mjs); joining per
    // session counted that row twice — doubling `recorded` and reporting `rejected×2` for
    // one review (found in #82's second review).
    const joined = uniqueEnds(ss.map((s) => s.runId), ends);
    return {
      stage,
      sessions: ss.length,
      billedTokens: sum(ss, (s) => s.billedTokens),
      billedMedian: median(ss.map((s) => s.billedTokens)),
      contextTokens: sum(ss, (s) => s.contextTokens),
      recordedTokens: sum(joined, (r) => r.tokens),
      recordedSessions: joined.length,
      toolCalls: sum(ss, (s) => s.toolCalls),
      toolErrors: sum(ss, (s) => s.toolErrors),
      engineFaults: sum(ss, (s) => s.engineFaults.length),
      costUsd: sum(ss, (s) => s.costUsd),
      outcomes: joined.reduce((acc, r) => {
        acc[r.outcome ?? 'unknown'] = (acc[r.outcome ?? 'unknown'] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }).sort((a, b) => b.billedTokens - a.billedTokens);

  const failures = sessions.flatMap((s) =>
    (s.failures ?? []).map((f) => ({ ...f, runId: s.runId, stage: s.stage })));

  const taxonomy = [...new Set(failures.map((f) => f.category))].map((category) => {
    const rows = failures.filter((f) => f.category === category);
    return {
      category,
      count: rows.length,
      sessions: new Set(rows.map((r) => r.runId ?? r.name)).size,
      stages: [...new Set(rows.map((r) => r.stage ?? 'unknown'))].sort(),
      examples: rows.slice(0, 3).map((r) => ({
        runId: r.runId, stage: r.stage, tool: r.tool, command: r.command, detail: r.detail,
      })),
    };
  }).sort((a, b) => b.count - a.count);

  const retryLoops = sessions.flatMap((s) => repeatedFailures(s)).sort((a, b) => b.count - a.count);

  const missingSkillReads = failures
    .filter((f) => f.category === 'missing-skill')
    .map((f) => ({
      path: (/access '([^']*SKILL\.md)'/i.exec(f.detail)?.[1]
        ?? /[\w./-]*skills\/[\w-]+\/SKILL\.md/i.exec(f.detail)?.[0]
        ?? f.detail),
      stage: f.stage,
    }))
    .reduce((acc, r) => {
      const key = r.path;
      const cur = acc.get(key) ?? { path: key, count: 0, stages: new Set() };
      cur.count += 1;
      if (r.stage) cur.stages.add(r.stage);
      acc.set(key, cur);
      return acc;
    }, new Map());

  const engineFaults = sessions.flatMap((s) =>
    (s.engineFaults ?? []).map((f) => ({ runId: s.runId, stage: s.stage, ...f })));

  const sessionStarts = sessions.map((s) => s.startedAt).filter(Boolean).sort();
  const totalBilled = sum(sessions, (s) => s.billedTokens);
  const joinedEnds = uniqueEnds(sessions.map((s) => s.runId), ends);
  const totalRecorded = sum(joinedEnds, (r) => r.tokens);

  return {
    generatedAt,
    corpus: {
      sessions: sessions.length,
      // Files kept as loop sessions vs files parsed at all. Without it, a prompt-format
      // drift would shrink the corpus silently (same class as a skipped artifact).
      inputFiles,
      // What the collector attempted vs read. `null` when the input was a local tree,
      // where there is nothing to skip. A partial corpus must never be presented as a
      // complete one: "0 signals" and "12 of 50 artifacts unread" are different facts.
      artifacts,
      window: {
        from: sessionStarts[0] ?? null,
        to: sessionStarts[sessionStarts.length - 1] ?? null,
      },
      toolCalls: sum(sessions, (s) => s.toolCalls),
      toolErrors: failures.length,
      engineFaults: engineFaults.length,
      billedTokens: totalBilled,
      contextTokens: sum(sessions, (s) => s.contextTokens),
      recordedTokens: totalRecorded,
      costUsd: Number(sum(sessions, (s) => s.costUsd).toFixed(4)),
      joinedSessions: joinedEnds.length,
    },
    stages,
    engineFaults,
    taxonomy,
    retryLoops,
    missingSkills: [...missingSkillReads.values()]
      .map((m) => ({ ...m, stages: [...m.stages].sort() }))
      .sort((a, b) => b.count - a.count),
  };
}

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : '—');
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const cell = (s) => String(s ?? '—').replace(/\|/g, '\\|');

/**
 * Render the aggregate as the markdown a retro run reads. Facts only: the miner has no
 * judgment, so its last section lists the signals that still need an attribution and a
 * proposal from the retro agent.
 */
export function renderMarkdown(agg) {
  const { corpus: c } = agg;
  const L = [];
  L.push('# Session mining — evidence from the uploaded agent sessions');
  L.push('');
  L.push(`Generated ${agg.generatedAt}. Source: \`loop-sessions-<run_id>\` artifacts `
    + `(${fmt(c.sessions)} sessions).`);
  L.push('');
  if (c.artifacts) {
    const { attempted, read, skipped } = c.artifacts;
    L.push(`Corpus completeness: read ${fmt(read)}/${fmt(attempted)} artifacts`
      + (skipped
        ? `, **${fmt(skipped)} skipped** (download failure or an oversize zip) — every`
          + ' signal below covers only the artifacts that were read'
        : ' (none skipped)')
      + '.');
    L.push('');
  }
  L.push(`Window: ${c.window.from ?? '?'} → ${c.window.to ?? '?'}. `
    + `${c.joinedSessions} run \`end\` row(s) joined by runId`
    + (c.inputFiles ? `; ${fmt(c.inputFiles)} file(s) parsed → ${fmt(c.sessions)} loop session(s)`
      + (c.inputFiles > c.sessions ? ` (${fmt(c.inputFiles - c.sessions)} not a loop session — a prompt-format drift shrinks the corpus silently)` : '')
      : '')
    + '.');
  L.push('');
  L.push('## Cost — processed tokens vs the recorded `tokens` value');
  L.push('');
  if (!c.joinedSessions) {
    L.push('Recorded-token comparison unavailable: no session joined a run `end` row.');
  } else {
    L.push(`The run \`end\` row stores the **final context size**, not the tokens processed: `
      + `${fmt(c.billedTokens)} processed vs ${fmt(c.recordedTokens)} recorded `
      + `(${(c.billedTokens / Math.max(1, c.recordedTokens)).toFixed(1)}×) across the joined sessions.`);
  }
  L.push('');
  L.push('Units differ by construction: `processed tokens` sums every assistant call of each');
  L.push('session; `final context` is that session\'s last non-zero usage; `recorded` is the');
  L.push('run row\'s own `tokens` (for `pr-review`, the sum over both reviewers), so it covers');
  L.push('sessions this artifact may not contain.');
  L.push('');
  L.push('| stage | sessions | processed tokens | median | final context | recorded (run row) | tool calls | tool-error rate | engine faults | est. cost |');
  L.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const s of agg.stages) {
    L.push(`| ${cell(s.stage)} | ${s.sessions} | ${fmt(s.billedTokens)} | ${fmt(s.billedMedian)} | `
      + `${fmt(s.contextTokens)} | ${fmt(s.recordedTokens)} | ${fmt(s.toolCalls)} | `
      + `${pct(s.toolErrors, s.toolCalls)} | ${s.engineFaults} | $${s.costUsd.toFixed(3)} |`);
  }
  L.push(`| **total** | ${c.sessions} | ${fmt(c.billedTokens)} | | ${fmt(c.contextTokens)} | `
    + `${fmt(c.recordedTokens)} | ${fmt(c.toolCalls)} | ${pct(c.toolErrors, c.toolCalls)} | `
    + `${c.engineFaults} | $${c.costUsd.toFixed(3)} |`);
  L.push('');
  const outcomeRows = agg.stages.filter((s) => Object.keys(s.outcomes).length);
  if (outcomeRows.length) {
    L.push('Outcomes (from the joined run `end` rows): '
      + outcomeRows.map((s) => `${s.stage}: `
        + Object.entries(s.outcomes).map(([k, v]) => `${k}×${v}`).join(', ')).join('; ') + '.');
    L.push('');
  }

  L.push('## Engine faults');
  L.push('');
  if (!agg.engineFaults.length) {
    L.push('None: no assistant turn ended with `stopReason=error|aborted`.');
  } else {
    L.push('| run | stage | stop reason | message |');
    L.push('| --- | --- | --- | --- |');
    for (const f of agg.engineFaults) {
      L.push(`| ${cell(f.runId)} | ${cell(f.stage)} | ${cell(f.stopReason)} | ${cell(f.message)} |`);
    }
  }
  L.push('');

  L.push('## Tool-failure taxonomy');
  L.push('');
  if (!agg.taxonomy.length) {
    L.push('None.');
  } else {
    L.push('| class | failures | sessions | stages | example |');
    L.push('| --- | ---: | ---: | --- | --- |');
    for (const t of agg.taxonomy) {
      const ex = t.examples[0];
      const detail = ex ? `${ex.tool}: ${ex.command || ex.detail}` : '';
      L.push(`| ${cell(t.category)} | ${t.count} | ${t.sessions} | ${cell(t.stages.join(', '))} | ${cell(oneLine(detail, 140))} |`);
    }
  }
  L.push('');

  L.push('## Repeated failing commands (retry loops)');
  L.push('');
  if (!agg.retryLoops.length) {
    L.push('None: no (tool, command) pair failed twice in the same session.');
  } else {
    L.push('| run | stage | tool | command | failures | classes |');
    L.push('| --- | --- | --- | --- | ---: | --- |');
    for (const r of agg.retryLoops.slice(0, 15)) {
      L.push(`| ${cell(r.runId)} | ${cell(r.stage)} | ${cell(r.tool)} | ${cell(r.command)} | `
        + `${r.count} | ${cell(r.categories.join(', '))} |`);
    }
  }
  L.push('');

  L.push('## Skills the prompt names but the repo does not have');
  L.push('');
  if (!agg.missingSkills.length) {
    L.push('None.');
  } else {
    L.push('| path | reads | stages |');
    L.push('| --- | ---: | --- |');
    for (const m of agg.missingSkills) {
      L.push(`| ${cell(m.path)} | ${m.count} | ${cell(m.stages.join(', '))} |`);
    }
    L.push('');
    L.push('The opening ritual resolves `skills/<stage>/SKILL.md`; a stage without one pays a');
    L.push('failed `read` per run. Either add the skill or make the prompt name the fallback.');
  }
  L.push('');

  L.push('## Signals needing an attribution');
  L.push('');
  const signals = [];
  if (c.engineFaults) signals.push(`${c.engineFaults} engine fault(s) — failed/aborted assistant turns`);
  const errRate = c.toolCalls ? (100 * c.toolErrors) / c.toolCalls : 0;
  if (c.toolErrors) signals.push(`${c.toolErrors} failed tool calls (${errRate.toFixed(1)}% of ${fmt(c.toolCalls)})`);
  for (const t of agg.taxonomy.filter((x) => x.count >= 5)) {
    signals.push(`${t.category}: ${t.count} failures in ${t.sessions} session(s)`);
  }
  for (const r of agg.retryLoops.filter((x) => x.count >= 3)) {
    signals.push(`retry loop (${r.count}×) in ${r.runId ?? 'a session'}: ${oneLine(r.command, 80)}`);
  }
  for (const m of agg.missingSkills) signals.push(`${m.count} read(s) of the missing ${m.path}`);
  if (c.billedTokens && c.recordedTokens) {
    signals.push(`recorded \`tokens\` under-reports processed tokens by ${(c.billedTokens / c.recordedTokens).toFixed(1)}×`);
  }
  if (!signals.length) signals.push('none');
  for (const s of signals) L.push(`- ${s}`);
  L.push('');
  L.push('Each signal above needs one of: a rule/check proposal, a host fix, or a stated');
  L.push('reason it is not worth acting on. A signal carried across two retros without one');
  L.push('of those is an unresolved escalation, not a finding.');
  L.push('');
  return L.join('\n');
}
