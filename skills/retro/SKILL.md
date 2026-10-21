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
0. Read the session mining report for this run
   (`state/reports/<runId>.sessions.md`), which `entry.mjs` produces from the last
   `loop-sessions-*` artifacts before you start. It is the evidence base for this
   stage: processed tokens, engine faults, failed tool calls by class, retry loops,
   and skills the opening ritual names but the repo lacks. If the prompt says the
   report is unavailable, try `pnpm loop:sessions --limit 50 --out /tmp/sessions.md`;
   if that fails too, state in the report that the transcripts were not consumed —
   never present an unread corpus as "no signals".
1. Read `state/metrics/acceptance.jsonl` and end rows of `runs/*.jsonl`.
2. Compute: auto-acceptance rate (merged+released / PR-producing tasks) and
   human-intervention rate (needs-triage/needs-info/ready-for-human / triaged),
   plus token/duration medians per stage and per failure class. Use the mining
   report's processed-token totals for cost: a run `end` row's `tokens` is the final
   context size, not the tokens processed.
3. Attribute each trend change to: spec-input quality, triage verdict accuracy,
   verify/review misses, memory hygiene, model behavior — and to a **session
   signal**. Every signal the mining report lists must become a proposal or be
   dismissed with a stated reason; a signal carried across two retros without either
   is an unresolved escalation, not a finding.
4. Apply the four levers (each as a proposal PR, one per topic):
   - failure postmortem → rule/skill amendments (as in immediate mode)
   - trend attribution → flow changes (route harder classes to needs-triage,
     change gate order, revise review lenses)
   - review-problem taxonomy → top-N problem types get dedicated checks
   - memory/token hygiene → prune state files, promote high-frequency
     knowledge to the norms layer, shrink run context; a repeated failing tool
     command or a missing skill file is a tooling fix, not a prompt hint
5. Report the metrics in the PR bodies and in SUMMARY.md.

## Done when
- Every actionable insight became a proposal PR with evidence; no rule changed
  without human merge; metrics reported.
