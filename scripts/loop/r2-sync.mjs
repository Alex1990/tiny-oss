#!/usr/bin/env node
/**
 * R2 state layer sync CLI — invoked as a standalone workflow step (independent of
 * whether the agent has finished running).
 *
 * Usage: node scripts/loop/r2-sync.mjs pull|push|seed|check
 *   pull  job start: remote → local state/ (a failure MUST abort, otherwise push
 *         would overwrite the remote with an empty local state)
 *   push  job end (if: always()): local state/ → remote (no --delete, R2 has no
 *         versioning)
 *   seed  one-off seed of the state layer already present locally
 *   check connectivity and credential self-check
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
    console.log('usage: node scripts/loop/r2-sync.mjs pull|push|seed|check');
    process.exit(1);
  }
} catch (e) {
  console.error(`[loop:r2] error: ${e.message}`);
  process.exit(1);
}
