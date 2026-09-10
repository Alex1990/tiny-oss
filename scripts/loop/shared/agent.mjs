/**
 * 驱动 pi 无头执行一个 loop run。
 *
 * 分工：开场/执行/收尾由 agent 按 prompt 完成（与 A0 的 skill 约定一致）；
 * 本模块只负责构造 prompt、spawn、采集用量与退出信号、分类失败。
 * 状态写入仍由 agent 调 `pnpm loop end` 触发（复用 run.mjs 的白名单与幂等），
 * 编排层只在该调用缺失时兜底。
 *
 * pi 事实（2026-09 一手验证）：
 *   - `--mode json` → JSONL 事件流（session / agent_start / turn_* / message_* /
 *     tool_execution_* / agent_end）；末轮 message_end 带权威 usage 与 stopReason。
 *   - `--approve` 必需：非交互模式不弹 trust prompt，缺它就忽略项目本地资源。
 *   - 退出码：正常 0；末轮 stopReason=error|aborted → 1；SIGTERM 143 / SIGHUP 129。
 *   - print 模式合并管道 stdin 到初始 prompt（大 prompt 走 stdin，避开 argv 上限）。
 */

import { spawn } from 'node:child_process';

/** 提示词语言与 skills/AGENTS.md 保持一致（英文），避免 agent 在英文规范里读中文指令。 */
export function buildPrompt({ task, stage, runId, writeLevel, mode, repo, lead = [] }) {
  const L = [];
  L.push(`You are one automated run of the tiny-oss loop. Stage: ${stage}.`);
  L.push('');
  L.push('## Opening ritual (read in order, do not skip)');
  L.push('1. `AGENTS.md`');
  L.push('2. `docs/agents/ops.md`');
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
  if (writeLevel === 'report') {
    L.push('**Read-only with respect to GitHub.** Do NOT run any of:');
    L.push('`gh issue edit` / `gh issue comment` / `gh issue close` / `gh pr create` /');
    L.push('`gh pr merge` / `git push` / any other command that mutates GitHub.');
    L.push('Allowed: reading GitHub, editing the working tree, running the repo gates,');
    L.push('reading and writing `state/`. Any GitHub action you conclude is needed');
    L.push('(labels, comments, closing, opening a PR) must be written into the report');
    L.push('as a proposal for a human to execute.');
  } else {
    L.push('Write actions are permitted per ops.md (labels/comments/PR as the stage requires).');
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
  if (task) {
    L.push(`   Allowed outcomes for stage \`${stage}\` are declared in \`scripts/loop/shared/state.mjs\``);
    L.push('   (STAGE_OUTCOMES). Never invent one.');
  } else {
    L.push(`   This is a system-level run: \`outcome\` is recorded on the end row only (no task`);
    L.push('   transition). Use the outcome the skill prescribes for the sweep/retro it performed.');
  }
  L.push('3. Record checkpoints while working so a crash can resume meaningfully.');
  return L.join('\n');
}

/** JSONL → 事件数组；非 JSON 行（进度提示等）忽略。 */
export function parseEvents(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    const s = line.trim();
    if (!s || s[0] !== '{') continue;
    try { events.push(JSON.parse(s)); } catch { /* 忽略非事件行 */ }
  }
  return events;
}

/** 从事件流提取用量与末轮停止原因（usage 只在 message_end 权威）。 */
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

/** 采样 pi 的会话文件（artifact 用）：返回指定目录下最新的 .jsonl。 */
export const SESSION_HINT = 'session files land under --session-dir (uploaded as an artifact)';

export function runPi({ prompt, cwd, sessionDir, model, timeoutMs = 3600000, log = () => {} }) {
  return new Promise((resolve) => {
    const args = [
      '--mode', 'json',
      '--approve',
      '--skill', 'skills',
      '--session-dir', sessionDir,
      '-p', 'Follow the loop run instructions provided on stdin.',
    ];
    if (model) args.push('--model', model);

    // 引擎是模板层的实例变量 {{engine}}（05 §4.2）：默认 pi，可用 LOOP_ENGINE_CMD 覆盖
    // （如本地用别的 CLI/包装脚本跑同一契约）。
    const engine = (process.env.LOOP_ENGINE_CMD || 'pi').split(/\s+/).filter(Boolean);
    const child = spawn(engine[0], [...engine.slice(1), ...args], {
      cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      log(`[loop] run 超时（${Math.round(timeoutMs / 60000)}min），发送 SIGTERM`);
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

    child.stdin.on('error', () => { /* spawn 失败或提前退出时的 EPIPE 不应炸掉流程 */ });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * 失败分类（Q6 决策）：机器故障 → 重试；agent 判定失败 → 收件箱；分不清 → 保守重试。
 * 收件箱是给人看的，不该被 provider 抖动灌满（否则人工介入率失去意义）。
 * 退出码沿用 run 契约：0 完成 / 1 失败→收件箱 / 2 卡死中止 / 3 建议重试。
 */
export function classify({ code, signal, stderr, timedOut, stopReason }) {
  if (timedOut) return { exit: 2, kind: 'abort', reason: 'run 超时中止' };
  if (code === 0) return { exit: 0, kind: 'ok', reason: 'pi 正常退出' };
  if (code === 143 || code === 129 || signal) {
    return { exit: 2, kind: 'abort', reason: `被信号终止（${signal ?? code}）` };
  }
  if (code === -1) return { exit: 3, kind: 'retry', reason: 'pi 无法启动（安装/路径问题）' };
  const s = String(stderr ?? '');
  // 凭据/配置类故障（缺 key、key 无效、pi 未解析到模型）：属宿主配置问题，不是任务问题，
  // 绝不能因此把任务推进人工收件箱 —— 实测 pi 在无 key 时输出 "No models available"。
  if (/no models? available|no model resolved|use \/login|api key|unauthorized|forbidden|401|403|invalid.*(token|key)|not authenticated/i.test(s)) {
    return { exit: 3, kind: 'retry', reason: '引擎凭据/配置未就绪 → 重试（需检查 secrets）' };
  }
  if (/rate.?limit|429|timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|502|503|504|overloaded|capacity/i.test(s)) {
    return { exit: 3, kind: 'retry', reason: '疑似 provider/网络瞬时故障 → 重试' };
  }
  if (stopReason === 'error' || stopReason === 'aborted') {
    return { exit: 1, kind: 'failed', reason: `agent 停止原因=${stopReason} → 转收件箱` };
  }
  return { exit: 3, kind: 'retry', reason: `退出码 ${code} 无法归因 → 保守重试` };
}
