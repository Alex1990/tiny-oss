---
name: review
description: Independent code review of a changeset by two isolated reviewer runs
  (maker/checker separation). Each run applies one distinct lens, produces a
  numbered diff-problem list, and the changeset only passes when both approve.
---
# Double review a changeset

The implementing agent (maker) must not be the only judge. The loop host runs
**two isolated reviewer processes** for `pr-review`: separate `pi` sessions
(`--session-dir`), a different `--model` for the second lens, and a read-only tool
allowlist (`read,grep,find,ls,bash`; no `edit`/`write`). Each run applies exactly one
lens and never sees the other's session or result file; the host merges the two
verdicts only after both finish. Do not try to spawn sub-agents — pi has no such
mechanism, and the isolation above is the host's job, not the reviewer's.

"Read-only" here means no `edit`/`write` tools, not a filesystem sandbox: `bash` is
present because a reviewer needs `git`/`gh` and the check gates, and it can still write
through the shell. A reviewer writes its report and result file with a `bash` heredoc
and keeps every other command read-only.

Review the diff, not the intent.

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
- Put the problem list in the result file's `comment` field; the host copies it into
  the PR comment.

## Resolution (the host, after both runs)
- Merge the two verdicts: both `approve` → `autoReview: pass` in the run record
  (outcome `accepted`); otherwise the PR carries both reviewers' problems and the
  task stays un-merged (outcome `rejected`).
- A reviewer that produced no verdict is **never** counted as approval: a transient
  failure returns the task to `retry`, anything else goes to the human inbox
  (`failed`).
- The maker fixes every L1 and L2 problem (L3 optional), re-runs `verify`, and the
  change is re-pushed; if a reviewer problem is deliberately rejected, the rejection
  must be recorded with a reason in the PR body.

## Done when
- Both reviewer runs issued a verdict into their own session and result file; all
  L1/L2 problems resolved or explicitly declined with reasons; `verify` gates green;
  verdict recorded in the run log.
