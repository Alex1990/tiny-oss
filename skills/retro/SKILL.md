---
name: retro
description: Self-improvement loop. Immediate mode: after a rejection, review
  failure, or incident, diagnose the single case and propose rules/skill changes.
  Scheduled mode: aggregate metrics (acceptance rates, human-intervention rate,
  tokens, duration), attribute trends, and propose process changes. All outputs
  are proposals — humans merge them.
---
# Retrospective

## Immediate mode (event: rejected / review-failed / incident)
Trigger: a task the loop produced was rejected or badly failed.
1. Reconstruct: run records (`runs/`), the task file, review problems, the
   human's actual rejection reason on the PR/issue.
2. Five whys toward one of: missing rule / tool gap / bad spec input /
   context failure / model limitation.
3. Produce ONE concrete proposal:
   - a new or amended rule → AGENTS.md/docs/ops.md change, or
   - a new check in an existing skill, or
   - a note that this task class should route to `needs-triage` instead.
4. Open a PR (or draft PR) with the proposal + the case study link. Never merge
   it yourself.

## Scheduled mode (timer, e.g. weekly)
1. Read `state/metrics/acceptance.jsonl` and end rows of `runs/*.jsonl`.
2. Compute: auto-acceptance rate (merged+released / PR-producing tasks) and
   human-intervention rate (needs-triage/needs-info/ready-for-human / triaged),
   plus token/duration medians per stage and per failure class.
3. Attribute each trend change to: spec-input quality, triage verdict accuracy,
   verify/review misses, memory hygiene, or model behavior.
4. Apply the four levers (each as a proposal PR, one per topic):
   - failure postmortem → rule/skill amendments (as in immediate mode)
   - trend attribution → flow changes (route harder classes to needs-triage,
     change gate order, revise review lenses)
   - review-problem taxonomy → top-N problem types get dedicated checks
   - memory/token hygiene → prune state files, promote high-frequency
     knowledge to the norms layer, shrink run context
5. Report the metrics in the PR bodies and in SUMMARY.md.

## Done when
- Every actionable insight became a proposal PR with evidence; no rule changed
  without human merge; metrics reported.
