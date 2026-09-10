#!/usr/bin/env node
/**
 * R2 状态层同步 CLI —— workflow 的独立步骤调用（不依赖 agent 是否跑完）。
 *
 * 用法: node scripts/loop/r2-sync.mjs pull|push|seed|check
 *   pull  job 开始：远端 → 本地 state/（失败必须中止，否则 push 会覆盖远端为本地空态）
 *   push  job 结束（if: always()）：本地 state/ → 远端（不带 --delete，R2 无版本化）
 *   seed  一次性播种本地已有状态层
 *   check 连通性与凭据自检
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeState } from './shared/state.mjs';
import { pull, push, seed, check } from './shared/r2.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = makeState(ROOT);
const cmd = process.argv[2];

try {
  if (cmd === 'pull') { console.log(`[loop:r2] pull → ${S.root}`); pull(S.root); }
  else if (cmd === 'push') { console.log(`[loop:r2] push ← ${S.root}`); push(S.root); }
  else if (cmd === 'seed') { console.log(`[loop:r2] seed ← ${S.root}`); seed(S.root); }
  else if (cmd === 'check') { check(); }
  else {
    console.log('用法: node scripts/loop/r2-sync.mjs pull|push|seed|check');
    process.exit(1);
  }
} catch (e) {
  console.error(`[loop:r2] error: ${e.message}`);
  process.exit(1);
}
