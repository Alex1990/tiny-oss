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
   in the working tree, never suppressed.
2. If a test fails because the code is mid-change, finish the change first;
   if it fails for an unrelated reason, stop and report (do not "fix" by
   skipping).
3. Re-run all gates until green. Record outputs (trimmed) in the run log.
4. Never claim verification success without the final command outputs.

## Done when
- All five gates pass with recorded output, or a gate failure is reported as a
  blocker with evidence.
