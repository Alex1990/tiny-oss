/**
 * Isolated double review for the `pr-review` stage (#71).
 *
 * `skills/review/SKILL.md` requires two independent reviewers, but pi has no
 * sub-agent mechanism: one `pi` process can only do two passes over one context. The
 * host therefore starts **two separate pi processes** — separate `--session-dir`, a
 * different `--model` for the second lens, and a read-only `--tools` allowlist — and
 * merges their verdicts with `mergeReviews`. The two processes share no session and no
 * result file, so neither can see the other's reasoning; the merge is the only place
 * their verdicts meet.
 *
 * The issue's option A (two runs in one job) is what this implements. Option B (a
 * workflow matrix) would need `.github/workflows/**`, which the job token cannot push.
 */

import path from 'node:path';

import { readJson } from './state.mjs';
import {
  buildPrompt, runPi, parseEvents, summarize, classify,
  reviewerResultName, pickReviewModel, mergeReviews, sumUsage,
  READONLY_REVIEW_TOOLS,
} from './agent.mjs';

/** The two lenses, run in order (each gets half the remaining wall-clock budget). */
const LENS_SLOTS = [
  { slot: 'a', lens: 'correctness & regression' },
  { slot: 'b', lens: 'standards, safety & maintainability' },
];

/**
 * Run reviewer A and reviewer B and merge their verdicts.
 *
 * The first reviewer uses `LOOP_MODEL`; the second uses a different model
 * (`LOOP_REVIEW_MODEL`, or the first DeepSeek catalogue entry that differs from
 * `LOOP_MODEL`). Both run with `--tools read,grep,find,ls,bash` and their own session
 * directory under `sessionDir`.
 *
 * @returns {{result: object, usage: object|null, toolCalls: number, turns: number,
 *            runs: object[], models: object}}
 */
export async function runDoubleReview({
  promptOptions, reportsDir, sessionDir, timeoutMs,
  writeLevel = 'report', cwd, log = () => {}, warn = () => {},
}) {
  const baseModel = process.env.LOOP_MODEL ?? null;
  const override = process.env.LOOP_REVIEW_MODEL ?? null;
  const reviewModel = pickReviewModel(baseModel, override);
  if (override && override === baseModel) {
    warn(`LOOP_REVIEW_MODEL=${override} equals LOOP_MODEL=${baseModel}; using `
      + `${reviewModel} for the second lens so the two reviewers differ (#71)`);
  }
  const models = { a: baseModel, b: reviewModel };

  // One shared budget for both reviewers: a hung first run must not leave the second
  // one unbounded inside a job that still has to push state and close out.
  const deadline = Date.now() + timeoutMs;
  const runs = [];
  for (const { slot, lens } of LENS_SLOTS) {
    const dir = path.join(sessionDir, `reviewer-${slot}`);
    const resultPath = path.join(reportsDir, reviewerResultName(promptOptions.runId, slot));
    const prompt = buildPrompt({ ...promptOptions, reviewSlot: slot });
    const remaining = Math.max(60_000, deadline - Date.now());
    const res = await runPi({
      prompt, cwd, sessionDir: dir, model: models[slot],
      tools: READONLY_REVIEW_TOOLS, timeoutMs: remaining, writeLevel, log,
    });
    const events = parseEvents(res.stdout);
    const { usage, stopReason, toolCalls, turns } = summarize(events);
    // The reviewer writes its own result file (read-only tools, so via `bash`); a
    // missing file is handled by mergeReviews, never treated as approval.
    const result = await readJson(resultPath);
    const cls = classify({
      code: res.code, signal: res.signal, stderr: res.stderr,
      timedOut: res.timedOut, stopReason,
    });
    log(`reviewer ${slot} (${lens}): model=${models[slot]} session=${dir} `
      + `exit=${res.code}${cls.kind === 'ok' ? '' : ` (${cls.kind}: ${cls.reason})`}`);
    runs.push({
      slot, lens, model: models[slot], sessionDir: dir, resultPath,
      result, cls, usage, stopReason, toolCalls, turns,
    });
  }

  return {
    result: mergeReviews(runs),
    usage: sumUsage(runs.map((r) => r.usage)),
    toolCalls: runs.reduce((n, r) => n + r.toolCalls, 0),
    turns: runs.reduce((n, r) => n + r.turns, 0),
    runs,
    models,
  };
}
