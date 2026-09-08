---
name: triage
description: Quick-analysis of a GitHub issue or PR to classify it (bug / feature /
  question / cannot-handle / needs-info / wontfix), assign confidence, apply the
  canonical triage labels, and record the decision in the state layer. Run as the
  first step of any issue/PR entry loop.
---
# Triage a task

Classify one GitHub issue (or external PR) before any deeper work.

## Inputs
- Task id (from the triggering event) and its `state/tasks/<id>.json`.

## Steps
1. Read the task state file; if `status` is not `new`/`waiting-info`, stop
   (another instance owns it) and exit.
2. Read AGENTS.md conventions and `docs/agents/ops.md`; skim related docs the
   issue touches.
3. Judge: what does the reporter want? Reproduce mentally from the report —
   if a bug, can it be reproduced from the report alone? If a feature, is the
   spec complete enough to implement without asking?
4. Decide one verdict + confidence:
   - `question` → reply directly, then close (see step 6 note).
   - `needs-info` → missing steps/version/environment; list exactly what to ask.
   - `wontfix` → duplicate / out of scope / not actionable.
   - `bug` or `feature` → only with `confidence: high|medium`. `low` must go
     to `cannot-handle`.
   - `cannot-handle` → needs a human: taste, big refactor, cross-cutting.
5. Apply labels:
   - question/wontfix candidates → `wontfix`
   - needs-info → `needs-info`
   - cannot-handle → `needs-triage` (inbox) or `ready-for-human` when clearly a
     human implementation task
   - bug/feature (high/medium) → `ready-for-agent`
6. Record in the task state file: `decision` block, `status`, timeline entries.
7. For `question`/`wontfix`: post the reply comment, close the issue with the
   reason, mark `status: closed`, and exit without further work.

## Done when
- Task state holds a recorded verdict with confidence, labels on GitHub match
  the decision, and (for closed tasks) the issue is closed with a comment.
