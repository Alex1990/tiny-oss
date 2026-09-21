/**
 * Drive pi headlessly to execute one loop run.
 *
 * Division of labour: opening/execution/closing are done by the agent per the prompt
 * (matching the skill convention in A0); this module only builds the prompt, spawns,
 * collects usage and exit signals, and classifies failures.
 * State writes are still triggered by the agent calling `pnpm loop end` (reusing
 * run.mjs's whitelist and idempotency); the orchestration layer only falls back when
 * that call is missing.
 *
 * pi facts (verified first-hand 2026-09):
 *   - `--mode json` → JSONL event stream (session / agent_start / turn_* / message_* /
 *     tool_execution_* / agent_end); the last message_end carries the authoritative
 *     usage and stopReason.
 *   - `--approve` is required: non-interactive mode shows no trust prompt, and without
 *     it project-local resources are ignored.
 *   - exit codes: normal 0; last-turn stopReason=error|aborted → 1; SIGTERM 143 / SIGHUP 129.
 *   - print mode merges piped stdin into the initial prompt (large prompts go over stdin
 *     to avoid the argv limit).
 */

import { spawn } from 'node:child_process';
import { PR_CONTRACT_SECTIONS } from './state.mjs';

/**
 * What each PR-contract section must contain (#73), keyed by the canonical heading
 * exported from `state.mjs`. Keeping the headings there and the hints here means the
 * maker prompt and the host's `validatePush` check cannot drift.
 */
const PR_CONTRACT_HINTS = {
  'What/why': 'intent in one or two sentences',
  'Proof it works': 'the actual gate output / manual steps / logs — not "should work"',
  'Risk tier + AI role': 'which parts the agent produced; what breaks if the change is wrong',
  'Review focus': 'the one or two places human judgment is actually needed',
};

/** Render the contract as the PR-body lines an author should produce. */
const prContractBodyLines = () => [
  'Closes #<n>',
  'loop-task: #<n>',
  ...PR_CONTRACT_SECTIONS.flatMap((h) => [`## ${h}`, PR_CONTRACT_HINTS[h] ?? '']),
];

/**
 * Read-only tool allowlist for the two isolated reviewers (#71): no `edit`/`write`,
 * so a reviewer cannot change the diff it judges. `bash` is included because the
 * reviewer needs `git diff` / `gh pr diff` and may run the check gates; it can still
 * write through the shell, so "read-only" means "no edit/write tools", not a
 * filesystem sandbox.
 */
export const READONLY_REVIEW_TOOLS = 'read,grep,find,ls,bash';

/**
 * Candidate models for the second reviewer lens.
 *
 * The loop runs on DeepSeek (the workflow installs only `DEEPSEEK_API_KEY` and
 * validates `LOOP_MODEL` against that catalogue), so "a different model" means one of
 * the other DeepSeek entries. `LOOP_REVIEW_MODEL` overrides the choice; without it,
 * pick the first entry that is not `LOOP_MODEL`. Both reviewers get an explicit
 * `--model`, so neither can silently inherit the other's.
 */
export const REVIEW_MODEL_CANDIDATES = [
  'deepseek/deepseek-v4-pro',
  'deepseek/deepseek-v4-flash-vision-exp',
  'deepseek/deepseek-v4-flash',
];

export function pickReviewModel(baseModel, override = null) {
  const base = baseModel || null;
  if (override && override !== base) return override;
  return REVIEW_MODEL_CANDIDATES.find((m) => m !== base) ?? base;
}

/** Result-file name for one isolated reviewer (path joins it to `state/reports`). */
export const reviewerResultName = (runId, slot) => `${runId}.reviewer-${slot}.result.json`;

const REVIEWER_LENS = {
  a: 'correctness & regression',
  b: 'standards, safety & maintainability',
};

/**
 * A reviewer's verdict, tolerating the small wording variations a model produces.
 * Falls back to the file's `outcome` when `decision.verdict` is missing.
 */
const reviewerVerdict = (r) => {
  const fallback = r?.result?.outcome === 'accepted' ? 'approve'
    : r?.result?.outcome === 'rejected' ? 'request-changes' : '';
  const raw = String(r?.result?.decision?.verdict ?? fallback)
    .trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (raw === 'approve' || raw === 'approved') return 'approve';
  if (raw === 'request-changes' || raw === 'changes-requested' || raw === 'request-change') {
    return 'request-changes';
  }
  return null;
};

/**
 * Merge the two isolated reviewer runs into the single result `finishRun` consumes.
 *
 * Conservative by construction: the changeset passes only when **both** reviewers
 * approve. A reviewer that produced no verdict is never counted as approval — a
 * transient engine failure keeps the task claimable (`retry`), anything else goes to
 * the human inbox (`failed`). This function is the only place the two verdicts meet;
 * the reviewer processes cannot see each other.
 */
export function mergeReviews(reviewers) {
  const describe = (r) => `reviewer ${r.slot} (${REVIEWER_LENS[r.slot] ?? r.slot}, `
    + `${r.model ?? 'default model'})`;
  const missing = reviewers.filter((r) => reviewerVerdict(r) === null);

  if (missing.length) {
    const transient = missing.some((r) => r.cls?.kind === 'retry');
    const outcome = transient ? 'retry' : 'failed';
    const who = missing.map(describe).join(', ');
    const reasons = missing.map((r) => r.cls?.reason ?? 'no result file').join('; ');
    return {
      outcome,
      note: `${who} produced no verdict (${reasons}); the double review is inconclusive`,
      comment: null,
      decision: {
        verdict: 'inconclusive',
        confidence: 'high',
        reason: `Isolated double review inconclusive: ${who} produced no verdict, `
          + 'which is never counted as approval.',
        autoReview: 'inconclusive',
        reviewers: reviewers.map((r) => ({
          slot: r.slot, model: r.model, sessionDir: r.sessionDir,
          verdict: reviewerVerdict(r), outcome: r.result?.outcome ?? null,
        })),
      },
    };
  }

  const pass = reviewers.every((r) => reviewerVerdict(r) === 'approve');
  const body = reviewers.map((r) => {
    const detail = r.result?.comment || r.result?.note || '(no detail provided)';
    return `**Reviewer ${r.slot} — ${REVIEWER_LENS[r.slot] ?? r.slot}** `
      + `(model \`${r.model ?? 'default'}\`, session \`${r.sessionDir}\`): `
      + `**${reviewerVerdict(r)}**\n\n${String(detail).trim()}`;
  }).join('\n\n');

  const header = pass
    ? '**Loop pr-review — approve** :white_check_mark: — two isolated reviewers'
    : '**Loop pr-review — request-changes** :warning: — two isolated reviewers';
  return {
    outcome: pass ? 'accepted' : 'rejected',
    note: `${pass ? 'both' : 'not both'} isolated reviewers approve `
      + `(A: ${reviewers[0]?.model ?? 'default'}, B: ${reviewers[1]?.model ?? 'default'})`,
    comment: `${header}\n\n${body}`,
    decision: {
      verdict: pass ? 'approve' : 'request-changes',
      confidence: 'high',
      reason: pass
        ? 'Both isolated reviewers approve: separate pi sessions, different models, '
          + 'read-only tool sets.'
        : 'At least one isolated reviewer requested changes; the changeset is not accepted.',
      autoReview: pass ? 'pass' : 'fail',
      reviewers: reviewers.map((r) => ({
        slot: r.slot, model: r.model, sessionDir: r.sessionDir,
        verdict: reviewerVerdict(r), outcome: r.result?.outcome ?? null,
      })),
    },
  };
}

/** Sum pi usage across the two reviewer runs (authoritative per-run on message_end). */
export function sumUsage(usages) {
  const us = (usages ?? []).filter(Boolean);
  if (!us.length) return null;
  const total = (k) => us.reduce((n, u) => n + (typeof u[k] === 'number' ? u[k] : 0), 0);
  const out = {
    input: total('input'),
    output: total('output'),
    totalTokens: total('totalTokens'),
    cost: { total: 0 },
  };
  for (const u of us) {
    const c = u.cost;
    if (c && typeof c === 'object') {
      for (const [k, v] of Object.entries(c)) {
        if (typeof v === 'number') out.cost[k] = (out.cost[k] ?? 0) + v;
      }
    }
  }
  return out;
}

/**
 * Prompt language matches skills/AGENTS.md (English) so the agent does not read
 * Chinese instructions inside English norms.
 */
export function buildPrompt({
  task, stage, runId, writeLevel, mode, repo, lead = [], reviewSlot = null,
}) {
  const L = [];
  L.push(`You are one automated run of the tiny-oss loop. Stage: ${stage}.`);
  L.push('');
  L.push('## Opening ritual (read in order, do not skip)');
  L.push('1. `AGENTS.md`');
  L.push('2. `docs/norms/ops.md`');
  L.push(`3. \`skills/${stage.replace(/-scheduled$/, '')}/SKILL.md\` (if missing, use the skills the stage calls for, e.g. verify/review)`);
  if (task) L.push(`4. \`state/tasks/${task.id}.json\``);
  L.push('');
  L.push('## This run');
  L.push(`- runId: \`${runId}\``);
  if (task) {
    L.push(`- task: #${task.id} (${task.kind}) — ${task.title}`);
    L.push(task.url ? `- GitHub: ${task.url}` : '- local synthetic task (no GitHub target)');
    if (task.body) L.push(`- body:\n\n${String(task.body).slice(0, 4000)}`);
  } else {
    L.push(`- system-level stage \`${stage}\`: no single task. Survey the whole repository`);
    L.push(`  (open issues/PRs vs \`state/tasks/*.json\`) and do what the skill prescribes for \`${stage}\`.`);
  }
  if (lead.length) {
    L.push('');
    L.push('## Event context');
    for (const l of lead) L.push(`- ${l}`);
  }
  if (reviewSlot) {
    const lens = reviewSlot === 'a'
      ? 'Reviewer A — Correctness & regression'
      : 'Reviewer B — Standards, safety & maintainability';
    L.push('');
    L.push(`## Isolated reviewer ${reviewSlot.toUpperCase()}`);
    L.push('You are one of two reviewers for this pull request. Apply only your lens:');
    L.push(`**${lens}** as defined in \`skills/review/SKILL.md\`.`);
    L.push('The other reviewer runs in a separate pi process with its own session and a');
    L.push('different model; you cannot see its work and it cannot see yours. Do not run the');
    L.push('other lens, do not spawn sub-agents, and do not read the other reviewer\'s files or');
    L.push('session. The host merges your two verdicts after both runs finish.');
    L.push('');
    L.push('Both lenses share a PR-contract gate (step 0 in the skill): a loop PR body');
    L.push(`missing any of ${PR_CONTRACT_SECTIONS.map((h) => `**${h}**`).join(', ')}`);
    L.push('is `request-changes` before any line-level review.');
    L.push('');
    L.push('You hold a **read-only tool set**: the allowlist is `read,grep,find,ls,bash` —');
    L.push('there is no `edit` or `write` tool. Write your report and result file with a `bash`');
    L.push('heredoc, and keep every other command read-only. Read-only here means no');
    L.push('edit/write tools; it is not a sandbox, so do not use `bash` to change the tree.');
    L.push('');
    L.push('Set `decision.verdict` to `approve` or `request-changes` and put your numbered');
    L.push('problem list (`[L<severity>] file:line — problem — suggested fix`) in the result');
    L.push('file\'s `comment` field. Use outcome `accepted` for `approve` and `rejected` for');
    L.push('`request-changes`.');
  }
  L.push('');
  L.push(`## Write boundary: ${writeLevel}`);
  L.push('### GitHub: the host writes, you do not');
  L.push('Your `GH_TOKEN` is the job token and it *can* write — labels, comments,');
  L.push('branches, pull requests. Do not use it for that. Every GitHub write in this');
  L.push('system is executed by the host process from your result file: that is the');
  L.push('division of labour, not a limitation you should work around. Do not run');
  L.push('`gh issue edit|comment|close`, `gh pr create`, `gh pr merge`, `gh pr review` or');
  L.push('`git push` yourself.');
  L.push('');
  L.push('It is also not the only line of defence, and deliberately so: `main` is');
  L.push('protected by the `Main branch` ruleset — every change must arrive through a pull');
  L.push('request carrying one approving review, the only bypass actor is the repository');
  L.push('owner, and this job has no `administration` scope. A direct push to `main`, an');
  L.push('unapproved merge, or an attempt to weaken the ruleset fails for *any* credential');
  L.push('you could hold. Do not spend turns probing it.');
  L.push('');
  L.push('Allowed: reading GitHub, editing the working tree, running the repo gates,');
  L.push('reading and writing `state/`.');
  if (reviewSlot) {
    L.push('');
    L.push('### Reviewer boundary: read-only, verdict only');
    L.push('Do **not** commit, push, open or merge a pull request, and do not modify the');
    L.push('working tree — your job is the verdict, not the fix. The host merges the two');
    L.push('reviewers\' verdicts and performs any GitHub write.');
  } else if (writeLevel === 'report') {
    L.push('');
    L.push('### `report` mode: the host writes nothing either');
    L.push('**Do not commit.** No branch will be pushed — a commit would be discarded with');
    L.push('the checkout. Deliver the change as a patch inside your report (the diff, or the');
    L.push('exact edits), and say what a human must do. Any GitHub action you conclude is');
    L.push('needed (labels, comments, closing, opening a PR) goes into the report as a');
    L.push('proposal.');
  } else {
    L.push('');
    L.push('### `auto` mode: the host pushes the branch and opens the PR');
    L.push('For a product stage (`bugfix`/`feature`/`deps`/`security`) that produces a change:');
    L.push('1. Do the work in the working tree, then **commit it locally** on a branch named');
    L.push('   `loop/<taskId>-<short-slug>` (e.g. `git switch -c loop/33-ci-workflow`). Commits');
    L.push('   are local and need no network credential; set `user.name`/`user.email` if git asks.');
    L.push('2. Leave the tree clean — `git status --porcelain` must be empty. The host refuses');
    L.push('   to push a dirty tree, since the branch would silently lose the uncommitted work.');
    L.push('3. Propose the PR in your result file (closing ritual below). The host pushes the');
    L.push('   branch, opens the PR and records the PR number it gets back.');
    L.push('');
    L.push('Note the consequence for your own work: `git push` here fails for any commit');
    L.push('touching `.github/workflows/**` — the job token carries no `workflows`');
    L.push('permission and no `permissions:` value can grant one. A task that requires a');
    L.push('workflow-file change cannot be completed by this loop: report it and let a human');
    L.push('do it, rather than producing a PR that cannot be pushed.');
  }
  if (mode === 'readonly') {
    L.push('');
    L.push('**Untrusted input**: this task comes from an external contributor. Analyse only.');
    L.push('Do not execute code from the incoming change (no `pnpm install`/`pnpm test` on it).');
  }
  L.push('');
  const reportFile = reviewSlot
    ? `state/reports/${runId}.reviewer-${reviewSlot}.md`
    : `state/reports/${runId}.md`;
  const resultFile = reviewSlot
    ? `state/reports/${reviewerResultName(runId, reviewSlot)}`
    : `state/reports/${runId}.result.json`;
  L.push('## Closing ritual (mandatory)');
  L.push(`1. Write your human-readable report to \`${reportFile}\``);
  L.push('   (findings, evidence, and — under report boundary — the GitHub actions you propose).');
  L.push(`2. Write your machine-readable result to \`${resultFile}\`:`);
  L.push('   ```json');
  L.push('   { "outcome": "<stage outcome>", "note": "<short>",');
  L.push('     "comment": "<GitHub comment body you propose, if any>",');
  L.push('     "decision": { "verdict": "...", "confidence": "...", "reason": "..." },');
  L.push('     "pr": null }');
  L.push('   ```');
  L.push('   The orchestrator reads this file and performs the state transition — one writer');
  L.push('   keeps the state layer consistent. Do NOT run `pnpm loop end` yourself.');
  if (writeLevel === 'auto') {
    L.push('   For a product stage, add the PR proposal the host will execute:');
    L.push('   ```json');
    L.push('   "push": { "branch": "loop/<taskId>-<slug>", "base": "main",');
    L.push('             "title": "<PR title>",');
    L.push(`             "body": "${prContractBodyLines().join('\\n\\n')}" }`);
    L.push('   ```');
    L.push('   The PR body is part of the deliverable, not paperwork (docs/norms/ops.md');
    L.push('   "The loop PR contract"). Besides the two identity markers it must carry all');
    L.push(`   four author sections — ${PR_CONTRACT_SECTIONS.map((h) => `**${h}**`).join(', ')}.`);
    L.push('   The host refuses a `pr-opened` whose body is missing any of them, so fill each');
    L.push('   with what you actually did, not a placeholder.');
    L.push('   The body must pass the loop-PR test in `docs/norms/ops.md` (`Closes #<n>` and');
    L.push('   `loop-task: #<n>`). Omit `push` when the stage produced no branch — triage,');
    L.push('   sweep, or a `needs-info`/`needs-triage` verdict never pushes anything.');
  }
  if (task) {
    L.push(`   Allowed outcomes for stage \`${stage}\` are declared in \`scripts/loop/shared/state.mjs\``);
    L.push('   (STAGE_OUTCOMES). Never invent one.');
  } else {
    L.push(`   This is a **system-level run** (no single task): the outcome only records how the`);
    L.push('   run went and never moves a task. Use exactly one of `completed` (stage finished),');
    L.push('   `failed` (it could not be completed) or `retry` (transient/environmental problem).');
  }
  L.push('3. Record checkpoints while working so a crash can resume meaningfully.');
  return L.join('\n');
}

/** JSONL → event array; non-JSON lines (progress notices etc.) are ignored. */
export function parseEvents(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try { events.push(JSON.parse(s)); } catch { /* ignore non-event lines */ }
  }
  return events;
}

/**
 * Extract usage and the last-turn stop reason from the event stream
 * (usage is authoritative only on message_end).
 */
export function summarize(events) {
  const ends = events.filter((e) => e.type === 'message_end' && e?.message?.role === 'assistant');
  const last = ends[ends.length - 1] ?? null;
  return {
    usage: last?.message?.usage ?? null,
    stopReason: last?.message?.stopReason ?? null,
    toolCalls: events.filter((e) => e.type === 'tool_execution_end').length,
    turns: events.filter((e) => e.type === 'turn_end').length,
  };
}

/**
 * Sample pi's session files (for the artifact): return the newest .jsonl in the
 * given directory.
 */
export const SESSION_HINT = 'session files land under --session-dir (uploaded as an artifact)';

/**
 * The environment handed to the agent subprocess.
 *
 * The agent holds the job token, because a job has exactly one and both the host and
 * the agent run inside it. What keeps the loop out of `main` is therefore **not** the
 * agent's credential — it is the `Main branch` ruleset: every change must arrive
 * through a pull request with one approving review, the sole bypass is the repository
 * owner, and this job's `permissions:` carry no `administration`, so the loop cannot
 * weaken that ruleset either. See "Branch protection is the gate" in
 * scripts/loop/README.md.
 *
 * What is still worth removing here is everything the agent could reach that the
 * ruleset does **not** cover: the R2 credentials address the state-layer bucket
 * directly, and only the host's `r2-sync` steps need them.
 */
export function agentEnv(writeLevel, base = process.env) {
  const env = { ...base };
  for (const k of [
    'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET',
  ]) delete env[k];
  // Product stages commit the branch the host pushes, and the identity must not come
  // from the sandbox's global git config (there is none on a fresh runner). Set it
  // here rather than making the agent discover it: a commit is a local operation.
  //
  // The identity is GitHub Actions' own bot (`github-actions[bot]`), matching the PR
  // author the host opens with the job token. The previous
  // `loop@users.noreply.github.com` resolved to the real, unrelated account @loop
  // (id 1519971), so every loop commit was falsely attributed to a stranger (#52,
  // #56). A bot noreply address is not a user account, so it cannot be squatted the
  // way a bare login can.
  if (writeLevel === 'auto') {
    env.GIT_AUTHOR_NAME = env.GIT_AUTHOR_NAME ?? 'github-actions[bot]';
    env.GIT_AUTHOR_EMAIL = env.GIT_AUTHOR_EMAIL
      ?? '41898282+github-actions[bot]@users.noreply.github.com';
    env.GIT_COMMITTER_NAME = env.GIT_COMMITTER_NAME ?? env.GIT_AUTHOR_NAME;
    env.GIT_COMMITTER_EMAIL = env.GIT_COMMITTER_EMAIL ?? env.GIT_AUTHOR_EMAIL;
  }
  return env;
}

export function runPi({
  prompt, cwd, sessionDir, model, tools = null,
  timeoutMs = 3600000, writeLevel = 'report', log = () => {},
}) {
  return new Promise((resolve) => {
    const args = [
      '--mode', 'json',
      '--approve',
      '--skill', 'skills',
      '--session-dir', sessionDir,
      '-p', 'Follow the loop run instructions provided on stdin.',
    ];
    if (model) args.push('--model', model);
    // An allowlist for the reviewer runs (#71): only the named tools are enabled.
    if (tools) args.push('--tools', tools);

    // The engine is the template layer's instance variable {{engine}} (05 §4.2): defaults
    // to pi, overridable with LOOP_ENGINE_CMD (e.g. run the same contract locally through
    // another CLI or wrapper script).
    const engine = (process.env.LOOP_ENGINE_CMD || 'pi').split(/\s+/).filter(Boolean);

    // The agent holds the same job token the host does — a job has one. What keeps the
    // loop out of `main` is the branch ruleset, not a credential difference; see
    // `agentEnv` above and "Branch protection is the gate" in scripts/loop/README.md.
    const childEnv = agentEnv(writeLevel);
    log('[loop] agent GitHub credential: the job token (its write reach is bounded by the'
      + ' `Main branch` ruleset, not by this variable)');

    const child = spawn(engine[0], [...engine.slice(1), ...args], {
      cwd, env: childEnv, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      log(`[loop] run timed out (${Math.round(timeoutMs / 60000)}min), sending SIGTERM`);
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 30000).unref?.();
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\nspawn error: ${e.message}`, timedOut });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ code: code ?? (signal ? 1 : 0), signal, stdout, stderr, timedOut });
    });

    // EPIPE when spawn fails or the process exits early must not crash the flow.
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Failure classification (Q6 decision): machine failure → retry; agent-judged failure →
 * inbox; unclear → retry conservatively.
 * The inbox is for humans and must not be flooded by provider flakiness (otherwise the
 * human-intervention rate loses meaning).
 * Exit codes follow the run contract: 0 done / 1 failed→inbox / 2 abort / 3 retry suggested.
 */
export function classify({ code, signal, stderr, timedOut, stopReason }) {
  if (timedOut) return { exit: 2, kind: 'abort', reason: 'run timed out and was aborted' };
  if (code === 0) return { exit: 0, kind: 'ok', reason: 'pi exited normally' };
  if (code === 143 || code === 129 || signal) {
    return { exit: 2, kind: 'abort', reason: `terminated by signal (${signal ?? code})` };
  }
  if (code === -1) {
    return { exit: 3, kind: 'retry', reason: 'pi failed to start (install/path problem)' };
  }
  const s = String(stderr ?? '');
  // Credential/config failures (missing key, invalid key, pi resolved no model): these are
  // host configuration problems, not task problems, and must never push a task into the
  // human inbox — observed: pi prints "No models available" when there is no key.
  if (/no models? available|no model resolved|use \/login|api key|unauthorized|forbidden|401|403|invalid.*(token|key)|not authenticated/i.test(s)) {
    return {
      exit: 3, kind: 'retry',
      reason: 'engine credential/config not ready → retry (check secrets)',
    };
  }
  if (/rate.?limit|429|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|502|503|504|overloaded|capacity/i.test(s)) {
    return { exit: 3, kind: 'retry', reason: 'suspected transient provider/network flake → retry' };
  }
  if (stopReason === 'error' || stopReason === 'aborted') {
    return { exit: 1, kind: 'failed', reason: `agent stopReason=${stopReason} → to inbox` };
  }
  return {
    exit: 3, kind: 'retry',
    reason: `exit code ${code} unclassifiable → retry conservatively`,
  };
}
