# Loop Operations Handbook

tiny-oss is run by a loop system. You (an agent run) were launched by the
repo's loop.yml to handle one stage of one task. Read this file first, then
the relevant skill in `skills/`.

## Actors

| Actor | Role |
| --- | --- |
| GitHub | events, human interface (issues/PRs/labels/reviews) |
| Loop workflow (Actions) | serializes runs (concurrency group), routes events, writes acceptance events |
| Sandbox (runner) | your execution environment (fresh per job) |
| You (run) | execute a stage; record everything to the local `state/` mirror |
| Human | merges PRs, cuts releases, digests `needs-triage`/`ready-for-human` |

## Trigger → loop map

| Event | Stage |
| --- | --- |
| issue opened/reopened/edited | `triage` → `bugfix`/`feature`/close/`needs-info` |
| loop PR opened/synchronize/review | `pr-review` |
| external PR opened | read-only analysis + `needs-triage` |
| PR merged (loop PR) | acceptance record (dispatcher) |
| schedule daily | `sweep` |
| schedule weekly | `retro-scheduled` |
| rejection / review failure | `retro-immediate` |
| dependency/security | `deps`/`security` → bugfix template or `needs-triage` |

## Run ritual

Opening (always):
1. Read this file + AGENTS.md + the relevant skill.
2. Read `state/tasks/<id>.json`; if `status=processing` and your lock owns it
   or its lock is dead → resume from the last checkpoint instead of restarting.
3. Read GitHub state of the task (`gh issue view <n> --comments`, labels).

Closing (always, before exit):
1. Write the run record (end row with tokens/durationMs/outcome).
2. Update the task file (status, timeline).
3. Refresh `state/SUMMARY.md`. Exit `0` on success.

Never do work outside the declared stage; never modify norms-layer files
(AGENTS.md, docs/agents/*, skills/*) except as a proposal PR.

## Labels → task state

| Label | Task status |
| --- | --- |
| `needs-triage` | `waiting-human` (inbox) |
| `needs-info` | `waiting-info` |
| `ready-for-agent` | `ready`/`processing` (claimable) |
| `ready-for-human` | `waiting-merge` or human-implementation |
| `wontfix` | `closed` (direct close) |
| (none, merged) | `accepted` |
| (none, closed unmerged) | `rejected` |

## Metrics (why you record things)

- Auto-acceptance rate = tasks that produced a PR and were merged (or
  released) / tasks that produced a PR. Direct closes and pure replies never
  enter the denominator.
- Human-intervention rate = tasks routed to `needs-triage`/`needs-info`/
  `ready-for-human` / tasks triaged.
- Both are computed from `state/metrics/acceptance.jsonl` + run end rows.
- The loop workflow writes acceptance events from PR close/merge and release
  events (sweep reconciles drift with `sweep-corrected`). You never write
  them; you only record runs, checkpoints, and task state.

## Quick rules

- Loop PR = head branch `loop/<issueNo>-*`, body `Closes #<n>` and
  `loop-task: #<n>`.
- Don't claim a task whose lock is live; don't fight a live lock.
- No self-merge; no norms-layer edits without a PR; no npm publish by the loop.
