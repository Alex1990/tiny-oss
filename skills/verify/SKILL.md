---
name: verify
description: Run the repo's full check gates (lint, format, types, tests, build),
  fix what the gates report, and only report success when every gate passes with
  actual command output. Use at the end of every code-producing step and before
  opening a PR.
---
# Verify the workspace

## Gates (from package.json)
1. `pnpm lint`
2. `pnpm fmt:check` (auto-fix with `pnpm fmt`)
3. `pnpm check:types`
4. `pnpm test` (unit + signature oracle specs; integration specs need
   `pnpm serve` first — see AGENTS.md)
5. `pnpm build`

## Steps
1. Run each gate. Fix what it reports — formatting/lint/type issues are fixed
   in the working tree, never suppressed or configured away.
2. If a test fails because the code is mid-change, finish the change first;
   if it fails for an unrelated reason, stop and report (do not "fix" by
   skipping, deleting or editing the test).
3. Re-run all gates until green. Record outputs (trimmed) in the run log.
4. Never claim verification success without the final command outputs.
5. Collect the PR-contract evidence while the run is fresh (`docs/norms/ops.md`,
   "The loop PR contract"): the gate outputs become the PR's **Proof it works**, and
   note the **Risk tier + AI role** and **Review focus** alongside them. A product
   stage that opens a PR carries all four in the PR body; the host refuses a
   `pr-opened` whose body is missing any of them.

## Never make a gate pass by weakening it

Green is evidence only if the check that produced it still measures the same thing.
When a gate is red, the fix is the behaviour, not the gate:

- Do not delete, skip (`it.skip`/`describe.skip`/`todo`) or rename away a test to hide
  a failure.
- Do not relax a gate's configuration — `.oxlintrc.json`, `.oxfmtrc.json`,
  `tsconfig*.json`, the `vitest.config.ts` coverage block, or a `package.json` script —
  to silence it.
- Do not edit an assertion, snapshot or fixture to match the new behaviour without
  recording the reason in the PR body. The signer-oracle expectations
  (`AGENTS.md` "Hard constraints") are pinned and never editable.
- If you believe a test itself is wrong, state that in the PR body and leave the test
  alone; a reviewer decides, not the diff.

A gate that fails because of the change you are making means the change is not
finished; a gate that fails for an unrelated reason is a reported blocker, not an edit.

Coverage is not this rule: it proves a line ran, not that a test would notice if the
line were wrong. Mutation testing is the signal coverage cannot give.

## Done when
- All five gates pass with recorded output, or a gate failure is reported as a
  blocker with evidence.
- For a product stage, the four contract sections exist for the PR body, with the
  gate output as proof — or the run reports why it produced no PR.
