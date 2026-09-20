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
| issue labeled `ready-for-agent` | `bugfix` (`bug` label) / `feature` — the claim signal |
| loop PR opened/synchronize/review | `pr-review` |
| external PR opened | read-only analysis + `needs-triage` |
| PR merged (loop PR) | acceptance record (dispatcher) |
| schedule daily | `sweep` |
| schedule weekly | `retro-scheduled` |
| rejection / review failure | `retro-immediate` |
| dependency/security | `deps`/`security` → bugfix template or `needs-triage` |

### The claim signal

Triage's `ready-for-agent` verdict is the hand-off: it means "classified, high or
medium confidence, the loop may implement this". The task then runs `bugfix` when the
issue also carries `bug`, and `feature` otherwise.

Two ways it fires, and they are deliberately different mechanisms:

- **A human applies `ready-for-agent`** → the `issues.labeled` event runs the stage
  directly. This is also how a maintainer claims any issue for the loop by hand.
- **The loop applies it** (the ordinary triage verdict) → GitHub suppresses runs for
  events raised by `GITHUB_TOKEN`, so no `labeled` run exists. `entry.mjs` therefore
  dispatches the next stage with `gh workflow run`, which is the documented exception
  to that suppression. This is what the loop's `actions: write` scope is for.

Consequence to keep in mind when auditing scopes: the loop can start its own
workflows. It still cannot change `main` (ruleset) and cannot edit workflow files
(no `workflows` permission exists to grant).

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
(AGENTS.md, docs/norms/*, skills/*) except as a proposal PR.

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
- Host changes (`scripts/loop/**`) may arrive as loop PRs like any other change: the
  loop may be the maker and the owner's review is the checker, so a host change is
  not by itself a reason to route a task to `needs-triage`. Review the diff rather
  than the run log — the same PR can edit `gh-check.mjs` and the agent prompts, i.e.
  the machinery that would otherwise corroborate it. What keeps this honest is the
  ruleset, not the loop's restraint: `require_code_owner_review` with
  `.github/CODEOWNERS` owning `*` means only the owner's approval meets the review
  requirement, so the loop cannot merge its own work. `.github/workflows/**` stays
  human-only (next item).
- **`main` is protected by the `Main branch` ruleset**, and that — not a credential
  — is what makes the line above true: every change to `main` must arrive through a
  pull request carrying one approving review, the only bypass actor is the repository
  owner, and the job token has no `administration` scope, so the loop cannot weaken
  the rule. A direct push to `main` is refused for every credential the loop can
  hold. Do not plan around it, and do not try to reproduce it with token scoping: a
  PAT acts as its owner, who *is* the bypass actor. Details and the exact payload:
  `scripts/loop/README.md` § "Branch protection is the gate".
- The job token cannot push changes to `.github/workflows/**` (no `workflows`
  permission exists for `permissions:` to grant). A task that needs one is not
  loop work — route it to `needs-triage`/`ready-for-human`.
