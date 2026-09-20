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

/**
 * Prompt language matches skills/AGENTS.md (English) so the agent does not read
 * Chinese instructions inside English norms.
 */
export function buildPrompt({ task, stage, runId, writeLevel, mode, repo, lead = [] }) {
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
  if (writeLevel === 'report') {
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
  L.push('## Closing ritual (mandatory)');
  L.push(`1. Write your human-readable report to \`state/reports/${runId}.md\``);
  L.push('   (findings, evidence, and — under report boundary — the GitHub actions you propose).');
  L.push(`2. Write your machine-readable result to \`state/reports/${runId}.result.json\`:`);
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
    L.push('             "body": "Closes #<n>\\n\\nloop-task: #<n>\\n\\n<what and why>" }');
    L.push('   ```');
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
  prompt, cwd, sessionDir, model, timeoutMs = 3600000, writeLevel = 'report', log = () => {},
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
