---
name: review
description: Independent code review of a changeset by two separate reviewer
  agents (maker/checker separation). Each reviewer checks a distinct lens,
  produces a numbered diff-problem list, and the work is only done when every
  accepted problem is fixed and re-verified.
---
# Double review a changeset

The implementing agent (maker) must not be the only judge. Spawn two reviewer
agents with isolation (separate worktree or equivalent). They review the diff,
not the intent.

## Reviewer A — Correctness & regression
- Does the change do what the task state says it should?
- Tests: do new tests fail without the change (bug) or cover the feature
  surface (feature)? Are oracle/signature tests still green?
- Edge cases: empty inputs, part boundary, resumable-upload checkpoint,
  non-browser transports, tree-shaking impact (no cross-provider references).

## Reviewer B — Standards, safety & maintainability
- Conforms to AGENTS.md architecture & hard constraints (signer oracle pinning,
  self-contained entries).
- Docs updated where behavior/options changed (README/API/UPGRADING).
- No secrets, no dangerous patterns, no silent behavior changes.
- Naming/types consistent with `src/types.ts` conventions.

## Output (each reviewer)
- Verdict: `approve` | `request-changes`
- Numbered problems: `[L<severity>] file:line — problem — suggested fix`
- Severity: L1 must-fix / L2 should-fix / L3 nit

## Resolution
- Maker fixes every L1 and L2 problem (L3 optional), re-runs `verify`, and
  re-reviews the diff; if a reviewer problem is deliberately rejected, the
  rejection must be recorded with a reason in the PR body.
- Merge the two verdicts: both `approve` → `autoReview: pass` in run record;
  otherwise the PR carries the problems and the task stays un-merged.

## Done when
- Both reviewers issued a verdict; all L1/L2 problems resolved or explicitly
  declined with reasons; `verify` gates green; verdict recorded in run log.
