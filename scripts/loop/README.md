# scripts/loop — loop host (A1: Actions + R2)

## Overall purpose (owner directive, 2026-09-08)

> From here on, all work exists to **improve the Loop**. Every task (real issue,
> synthetic case, smoke test) is a vehicle for polishing the Loop: validating
> the run contract, exposing tool/skill/process defects, and distilling rules.
> Task completion is a byproduct; a better Loop is the acceptance criterion.

Accordingly, at the end of every trial run, ask yourself: what Loop defect or
improvement did this round expose? → record it in the list below or fix it
directly in this directory's files.

## Layout

```
.github/workflows/loop.yml   # scheduler + sandbox (05 §1/§5.1); one workflow, one serial domain
scripts/loop/
  entry.mjs                  # runner orchestrator: route event → inbox/metrics/run
  run.mjs                    # local CLI host (manual A0-style runs, `pnpm loop`)
  r2-sync.mjs                # state-layer pull/push/seed/check against R2
  shared/state.mjs           # STATE-LAYER PRIMITIVES — single writer for state/
  shared/route.mjs           # event → decision (pure functions, offline-testable)
  shared/agent.mjs           # pi driver: prompt, spawn, usage, failure classification
  shared/r2.mjs              # R2 sync via the runner's preinstalled AWS CLI
state/                       # ignored; on the runner it is a per-job snapshot of R2
```

**Single-writer rule:** both `run.mjs` and `entry.mjs` mutate the state layer
only through `shared/state.mjs`. Two implementations of the same rule is how
drift starts — the missing `#33` acceptance row was a human-drift instance of
exactly this.

## Local commands (unchanged; `pnpm loop` = `run.mjs`)

```bash
pnpm loop start --issue <n>                 # import a real issue + claim (stage defaults to triage)
pnpm loop start --task <n> [--stage <s>]    # claim an existing task (re-run after waiting-info is answered)
pnpm loop start --new --title "..."         # local synthetic task
pnpm loop checkpoint --run <r-xxx> --note "..."
pnpm loop end --run <r-xxx> --outcome <o> [--comment ".."] [--label <n>] [--no-github]
pnpm loop summary | view                    # summary / task list
```

### Write boundary (`--write-level` | `LOOP_WRITE_LEVEL`, default `report`)

| Level | Effect |
| --- | --- |
| `report` | State layer + report only. GitHub write actions are **listed, never executed** (A1 semantics). |
| `auto` | Executes labels/comments/close, and for `pr-opened` the host pushes the branch and opens the PR. |

In `report` mode the pending actions are appended to `state/reports/<runId>.md`
as a checklist and surfaced in the Actions Step Summary, so a human can execute
them by hand.

### Branch protection is the gate

`GH_TOKEN: ${{ github.token }}` — the job token, and the loop's **only** GitHub
credential. There is no PAT anywhere in the system.

That is not a weakness, because the property being enforced is not "the agent holds
a narrow token" — it is **"nothing reaches `main` without a human"**, and that is
enforced by repository configuration, not by scope lists:

```
Main branch (ruleset, active, target ~DEFAULT_BRANCH)
  rules:          deletion · non_fast_forward · pull_request
                  └─ required_approving_review_count: 1
  bypass_actors:  User(owner) with bypass_mode: pull_request
```

| Actor | direct push to `main` | merge a PR without an approval |
| --- | --- | --- |
| the owner (you) | ❌ refused | ✅ (bypass, `pull_request` mode) — **merging *is* the consent** |
| the loop (`github.token`) | ❌ refused — not a bypass actor | ❌ refused — it cannot approve its own PR, and a bot approval does not satisfy `require_code_owner_review` |

Two consequences worth stating plainly:

1. **`bypass_mode: pull_request` means the owner cannot push to `main` either.**
   The ruleset is not "the loop is restricted"; it is "every change arrives through a
   pull request", for everybody, with the owner able to merge their own without a
   second reviewer. Verified: an idempotent write to `refs/heads/main` answers
   `422 Changes must be made through a pull request`.
2. **A PAT would break this.** A user token *acts as its owner*, who is the bypass
   actor — so a loop holding one could merge an unapproved PR, and its PRs would also
   be authored by the owner, whom GitHub forbids approving their own work: the loop's
   PRs would then be unmergeable *and* unapproved-mergeable. Both halves are wrong,
   which is why the loop uses `github.token` and the PR author is
   `github-actions[bot]` — an identity you *can* approve.

`permissions:` cannot grant `administration`, so the loop cannot delete or weaken
that ruleset. `gh-check.mjs` asserts exactly that pair of properties (see below).

**A loop PR starts with its workflows unrun.** GitHub suppresses workflow runs for
events raised by `GITHUB_TOKEN` — the same recursion guard that stops the loop
triggering itself with a label — with one exception: a `pull_request` opened or
updated by `GITHUB_TOKEN` does create runs, but in an **approval-required** state.
Nothing runs until a human approves.

That has a consequence worth knowing before it confuses you: **a loop PR shows no
checks at all**, which reads like a broken workflow. It is not — CI is waiting.

Approval is per run, which is the useful part. A loop PR creates two: `CI` and
`Loop` (the latter because the PR is loop-produced, so it routes to `pr-review`).
Approving both makes the loop review its own work; approving only the first gives you
the thing you actually want:

```bash
gh api 'repos/Alex1990/tiny-oss/actions/runs?status=action_required' \
  --jq '.workflow_runs[] | "\(.id) \(.name)"'
gh api --method POST repos/Alex1990/tiny-oss/actions/runs/<ci-id>/approve
```

The UI's *Approve workflows to run* button approves every pending run for that PR,
so use it when you do not mind the self-review, and the API when you do. Verified on
PR #50: approving only the `CI` run left `Loop` at `completed/action_required` while
CI ran and passed.

This is deliberately worked around no further than a click. Switching the push and
the PR creation to a PAT would start CI by itself, and would also hand the loop the
owner's ruleset bypass — see the table above. One click is the cheaper half of that
trade.

What bounds the loop beyond `main` is therefore *not* a credential: the host owns
every write (`applyActions` derives them from the agent's `result.json`) as a division
of labour, and the agent is asked not to write — but if it did, the ruleset would
still refuse the only writes that matter.

**Cost of this design: the loop cannot change `.github/workflows/**`.** The job token
carries no `workflows` permission and `permissions:` has no key that grants one, so a
push containing a workflow-file change is rejected outright
(`refusing to allow a GitHub App to create or update workflow … without workflows
permission`). A PAT would push it, and would also carry the bypass above — so this is
a real trade, resolved in favour of the gate. Tasks that need a workflow change go to
a human; `applyActions` recognises the error and says so in the run log.

`node scripts/loop/gh-check.mjs` measures the whole boundary without spending a
token, in order of how much it matters:

1. **Is `main` un-writable?** `PATCH /git/refs/heads/main` writing back the SHA it
   just read — a `422 … pull request` is the pass, a `2xx` is a hard failure (and
   changes nothing either way).
2. **Can the loop edit its own gate?** A deliberately invalid `POST /rulesets`:
   `403` means no `administration`, `422` means the credential could remove the rule.
3. **Can the loop still work?** Reads, plus the Issues/Pull-requests/Contents writes
   it needs for labels, comments and branch pushes.

It exits non-zero when (1) or (2) fails, so the check can gate a switchover.

**The scope facts behind that**, since they are easy to get wrong — merging a PR is
under "Contents", not "Pull requests":

| Action | gh command | Permission required |
| --- | --- | --- |
| label / comment an **issue** | `gh issue edit` / `comment` | `Issues: write` |
| label / comment a **PR** | `gh pr edit` / `comment` | `Issues: write` **or** `Pull requests: write` — both sections list `POST /issues/{n}/labels` and `/issues/{n}/comments` |
| close an **issue** | `gh issue close` | `Issues: write` |
| close a **PR** | `gh pr close` | `Pull requests: write` (GraphQL `closePullRequest`, not an `/issues/` call) |
| open a PR | `gh pr create` | `Pull requests: write` **plus** `Contents: write` — the head branch must exist first |
| **merge a PR** | `gh pr merge` | **`Contents: write`** — `PUT /pulls/{n}/merge` |
| push / edit a file / delete a branch | `git push`, `PUT /contents/{path}`, `DELETE /git/refs/{ref}` | `Contents: write` |

Two consequences that are easy to get wrong:

1. **`Pull requests: write` cannot merge.** It covers `POST /pulls`,
   `PATCH /pulls/{n}`, reviews and review comments — the merge endpoint sits in
   the `Contents` section, because merging means writing commits to the target
   branch.
2. **"Can open a PR" and "can merge a PR" are the same permission** — within a single
   credential. Opening a PR needs a head branch; creating one needs `Contents: write`;
   and that is also the merge permission. **No scope list separates them**, which is
   why the separation here is not attempted with scopes: the loop may hold
   `Contents: write` and still never reach `main`, because reaching `main` requires an
   approval it cannot give itself. That is the design — see above.

(An earlier revision of this file tried to express it with three credential tiers —
`L2a` read-only, `L2b` full `Contents`, `L2c` split across two tokens. It does not
work. A PAT belongs to its owner, who is this repository's only admin and therefore
the ruleset's bypass actor, so a "narrow" PAT still inherits the ability to merge
unapproved PRs; and because that same owner authors the PRs, GitHub forbids approving
them — so the loop's output would be simultaneously un-approvable and
unapproved-mergeable. The tiers are recorded only so the next reader does not
re-derive them.)

### The ruleset, exactly

This is the part a human owns, and the only part no file in this repo can express. The
`Main branch` ruleset (id `21855851`, `target: branch`, `conditions.ref_name.include:
["~DEFAULT_BRANCH"]`):

```json
{
  "name": "Main branch",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [
    { "actor_id": <owner user id>, "actor_type": "User", "bypass_mode": "pull_request" }
  ],
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 1,
        "dismiss_stale_reviews_on_push": true,
        "require_code_owner_review": true,
        "require_last_push_approval": true,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["merge", "squash", "rebase"]
    } }
  ]
}
```

Applied with `gh api --method PUT repos/{owner}/{repo}/rulesets/21855851 --input
<file>`, and verified by reading back `current_user_can_bypass` — it must come back
`pull_requests_only` for the owner. If it comes back `never`, the `actor_id` did not
match anyone and **you are locked out too**: you could not merge your own PR, because
GitHub forbids approving your own work.

`bypass_mode: "pull_request"` is the load-bearing choice. `always` would let the owner
push straight to `main` (and any PAT ever handed to the loop would inherit that);
`pull_request` allows exactly one thing — merging a PR — which is the consent act.
The alternative, leaving `bypass_actors` empty, is stricter still and also coherent
(the owner would approve-and-merge loop PRs by hand), but it leaves the owner unable
to merge a PR they authored themselves.

`dismiss_stale_reviews_on_push: true` means a push to a PR branch invalidates its
approval: approving a diff approves that diff, not whatever arrives next.

`require_code_owner_review: true`, with `.github/CODEOWNERS` owning `*`, closes the
one path the approval count left open. The loop holds `pull-requests: write`, so
without a code-owner requirement it could approve a PR it did not author — one the
owner opened, or a dependabot PR — and then merge it with the same `Contents: write`
it needs to push branches. Under a code-owner requirement the bot's approval does not
count, so only the owner can satisfy the gate.

`require_last_push_approval: true` is the second half of the same idea: the person who
pushed the most recent reviewable commit cannot be the one who approves it, so a push
that rewrites a PR branch cannot then be self-approved.

GitHub also sets `require_extra_approval_for_unattributed_changes: true` on rulesets
carrying a `pull_request` rule (a public-preview default, not something set here).
It applies to Copilot-authored PRs and asks for one approval beyond the configured
count. It does not change the loop's path — its PRs come from `github-actions[bot]`,
and the owner's bypass allows the merge regardless of the count — but it is the
reason a future reader may see the parameter and wonder where it came from.

#### What the loop relies on, piece by piece

| Piece | Where | Behaviour |
| --- | --- | --- |
| `Main branch` ruleset | repository settings (`gh-check.mjs` asserts it) | The gate. Every change to `main` arrives through a PR with one approval; the owner is the only bypass, and only for merging. |
| `permissions:` | `.github/workflows/loop.yml` | `contents: write`, `issues: write`, `pull-requests: write`. No `administration` — so the loop cannot edit the ruleset, verified by probe. |
| `GH_TOKEN` | job env | `github.token`. No PAT exists in the system, so no credential carries the owner's bypass. |
| `agentEnv(writeLevel)` | `shared/agent.mjs` | Builds the child environment from scratch: strips the R2 keys (the state bucket is the host's business, not the agent's) and injects a git identity under `auto`. It does **not** hand the agent a weaker token — a job has only one. |
| `persist-credentials: false` | the `actions/checkout` step | Keeps the job token out of the repo's git config, where every later `git` invocation would pick it up. Defence in depth, not the mechanism. |
| `vars.LOOP_EXECUTE_WRITES` | job env | The switch. `workflow_dispatch` can override it per run: leave the input empty to follow the variable, or pass `true`/`false` to force one run. (The input has no `default:` on purpose — a non-empty default like `'false'` short-circuits the `github.event.inputs.x \|\| vars.x` fallback and makes the variable unreachable from the one entry point a human uses to test it, which is exactly what happened before this was fixed.) |
| stage hand-off | `entry.mjs` (`dispatchStage`) | After a `triaged` **issue**, triage dispatches the implementing stage (`bugfix` if the issue carries `bug`, else `feature`). It cannot rely on its own label: GitHub suppresses runs for `GITHUB_TOKEN`-raised events, and `workflow_dispatch` is the documented exception. This is the only consumer of `actions: write`. A failed dispatch warns and leaves the task claimable rather than failing the run. |
| `push` action | `planActions` | `pr-opened` plans `push` → `pr-create` → label/comment. A failure in either of the first two **aborts the chain**, so a PR that never appeared is never labelled. |
| branch check | `applyActions` | `loop/<issueNo>-<slug>` only — no other ref is pushed, whatever the branch field says. |
| dirty-tree check | `applyActions` | A dirty tree is refused: the commit would silently stay behind and the PR would ship an empty diff. |
| workflow-file recognition | `applyActions` | A push rejected for touching `.github/workflows/**` is explained (see the cost above) instead of retried. |
| `validatePush` | `entry.mjs` | `pr-opened` without a valid proposal (wrong branch, empty title, another task's number, missing PR-contract section, or `writeLevel=report`) is downgraded to `failed`, so a task can never sit in `waiting-merge` waiting for a PR nobody opened, and no loop PR reaches a reviewer without intent, proof, risk and review focus. |
| `ensureLoopPrBody` | `planActions` | Repairs the PR body's `Closes #<n>` / `loop-task: #<n>` markers. The router requires both, and a missing marker would make the loop's own PR look external — no acceptance row, and its merge would close the task by the wrong path. It only repairs those host-owned markers; the four author sections are validated by `validatePush` and never fabricated. |
| PR number recorded | `finishRun` | The number comes back from `gh pr create` and lands in `task.prs` + a `pr-created` timeline row. |
| git identity | `agentEnv` | `GIT_AUTHOR_*`/`GIT_COMMITTER_*` are injected under `auto` as GitHub Actions' own bot, `github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>` — the same identity the host's PR comes from. A fresh runner has no global git config, and the commit itself is local (no credential involved). The earlier `loop@users.noreply.github.com` belonged to the real, unrelated user `@loop`, so every loop commit was falsely attributed to them (#52, #56). |

Note what is **not** load-bearing: the host-versus-agent split. It exists because the
writes must be derived from the agent's result file in one place that can enforce the
branch and PR-marker rules — not because the host holds a credential the agent must
not see. If the agent wrote to GitHub itself, the only consequence that matters
(`main`) would still be refused by the ruleset.

## A1 architecture (Actions + R2)

```
GitHub event ─▶ loop.yml (concurrency group `loop` = platform-level single writer)
                 ├─ setup node/pnpm ▸ install pi ▸ print `pi --list-models deepseek`
                 ├─ r2-sync pull        (state layer → job-local state/)
                 ├─ entry.mjs           (route → inbox | metrics | terminal | run)
                 ├─ r2-sync push        (if: always() && pull did not skip — D34)
                 └─ upload pi sessions  (artifact, 90d)
```

- **Engine `{{engine}}` = pi** (`@earendil-works/pi-coding-agent@0.85.1`).
  Verified before adoption: headless `--mode json` JSONL event stream, DeepSeek
  built in (`DEEPSEEK_API_KEY`), ~21 MB with no install scripts, Node >= 22.19.
  `--approve` is **mandatory**: without it non-interactive runs silently ignore
  project-local resources.
- **pi has no built-in permission gating** (verified), so the boundary is built from
  the platform instead: the `Main branch` ruleset (asserted by `gh-check.mjs`), the
  job's `permissions:` block, the absence of secrets in fork contexts, and `agentEnv`
  (which strips the R2 keys from the child). Do not add write credentials to a job
  that touches untrusted input, and do not rely on the prompt for any of it.
- **One writer for closing:** the agent writes `state/reports/<runId>.result.json`;
  `entry.mjs` performs the transition via `finishRun`. Agents never run
  `pnpm loop end` themselves.
- **Sessions:** only the aggregate lands in the state layer (run `end` row:
  `tokens`/`durationMs`/`model`/`outcome`); full transcripts go to the
  artifact store (90 days).

### Isolated double review (`pr-review`)

`skills/review/SKILL.md` requires two independent reviewers, but pi has no
sub-agent mechanism — one process can only do two passes over one context. The host
(`shared/review.mjs`) therefore runs **two `pi` processes** for the `pr-review`
stage:

| | Reviewer A | Reviewer B |
| --- | --- | --- |
| session | `<LOOP_SESSION_DIR>/reviewer-a` | `<LOOP_SESSION_DIR>/reviewer-b` |
| model | `LOOP_MODEL` | `LOOP_REVIEW_MODEL`, else the first different DeepSeek model |
| tools | `read,grep,find,ls,bash` | `read,grep,find,ls,bash` |
| result | `<rid>.reviewer-a.result.json` / `.md` | `<rid>.reviewer-b.result.json` / `.md` |

They run in sequence (one shared wall-clock budget) and cannot see each other's
session or result file; `mergeReviews` is the only place their verdicts meet. The
changeset passes only when **both** approve (`accepted`); otherwise `rejected`. A
reviewer that produced no verdict is never counted as approval — a transient exit
becomes `retry`, anything else `failed`. The read-only allowlist has no `edit`/`write`
tool, so a reviewer writes its own result file with a `bash` heredoc; "read-only"
means "no edit/write tools", not a filesystem sandbox.

Each reviewer prompt carries its own lens and review slot, and the product-stage
commit/push instructions are suppressed for it (the reviewer's job is the verdict).

### Trigger → action (workflow)

| Event | Action |
| --- | --- |
| `issues` opened/reopened | run(triage) |
| `issues` labeled `ready-for-agent` | run(bugfix/feature) — the claim signal; fires only for labels applied by **people**, since GitHub suppresses runs for `GITHUB_TOKEN`-raised events |
| `issues` edited, `issue_comment` created | inbox first (never silently dropped), then run per task status |
| loop PR (`loop/<n>-*` **and** `loop-task: #<n>`) opened/synchronize | run(pr-review) |
| same-repo PR, other branches | run(triage) — PRs are a triage surface |
| `pull_request_review` on a loop PR | run(pr-review) |
| `pull_request_target` closed (loop PR) | metrics: merged / closed-unmerged **and** the task moves to `accepted` / `rejected` |
| `pull_request_target` closed (other PR) | task → `accepted` / `rejected` only; **no metric** (not loop-produced) |
| `release` published | metrics: released |
| `schedule` daily / weekly | system run: sweep / retro-scheduled |
| `workflow_dispatch` | run per inputs (`task`/`stage`); `model` overrides the engine model; `execute_writes=true` = L2 rehearsal |

Anything else is a no-op that still exits 0 — event storms cost nothing.

**Credential guard on `pull_request` (job-level `if`).** This is the only event
we listen to where secrets can be absent: GitHub treats a Dependabot-triggered
run like a fork run (read-only token, **no secrets at all**), and a fork PR
never has them. Unguarded, such a run dies at `Pull state from R2` and looks
exactly like a real defect. So a `pull_request` run is skipped unless the head
repository is this one **and** the actor is not `dependabot[bot]`.

The routing table above still describes what the *router* decides; the guard
means two of those rows cannot actually run today:

| Row | Status under A1 |
| --- | --- |
| external PR → run(triage, readonly) | **never runs** — even read-only analysis needs the LLM key. See D28. |
| dependabot PR → run(deps) | **never runs** — no secrets. See D28. |

`pull_request_target` (loop PR closed), `issues`, `schedule`, `release` and
`workflow_dispatch` all keep their secrets and are unaffected.

### Outcomes: two vocabularies

A run is either task-scoped or system-level, and they do not share an outcome
vocabulary — conflating them corrupts the metrics.

| | Task-scoped (`issues opened`, loop PR, …) | System-level (`sweep`, `retro-scheduled`, release preflight) |
| --- | --- | --- |
| Outcomes | `triaged`, `needs-info`, `needs-triage`, `pr-opened`, `closed`, `rejected`, `accepted`, `failed`, `retry` | `completed`, `failed`, `retry`, `aborted` |
| Effect | moves the task to its mapped status + label | records the run only; no task moves |
| Whitelist | per-stage (`STAGE_OUTCOMES` in `shared/state.mjs`) | `SYSTEM_OUTCOMES` |

`closed` is a *task* outcome meaning "closed without a PR, so it never enters
the acceptance denominator". A system-level run recording `closed` would make
retro count sweep/retro executions as closed tasks, so `finishRun` refuses it.
A real sweep initially reported `closed` for exactly this reason; the run now
records `completed`.

### Failure classification (exit codes)

The run contract wants 0/1/2/3/137; pi only reports 0/1/143/129. Machine faults
must not reach the human inbox, or the human-intervention metric becomes
noise:

| Situation | Outcome | Effect on task |
| --- | --- | --- |
| agent produced a valid result | agent's outcome | per `OUTCOME_MAP` |
| provider/network flake, spawn failure, unclassifiable exit | `retry` | back to `ready` (claimable) |
| pi aborted / timeout | `retry` (abort recorded) | back to `ready` |
| agent concluded it cannot complete | `failed` | `needs-triage` (human inbox) |

`retry` is a host-level outcome (documented in `shared/state.mjs`), not part of
the ops.md outcome table.

## R2 state layer

**One bucket per repository** (owner decision, 2026-09-10). Bucket name is
`loop-state-<owner>-<repo>`, derived at runtime (`shared/r2.mjs`): from
`GITHUB_REPOSITORY` in CI, from `package.json`'s `repository` field locally
(string, `github:` shorthand, SSH and https forms all resolve identically). So
tiny-oss writes to **`loop-state-alex1990-tiny-oss`**, and a sibling repo gets
its own bucket with no code change. `R2_BUCKET` overrides the derivation
(migration, triage, pointing at a scratch bucket).

Why not one bucket for all repos: **an R2 API token can only be scoped to a
bucket, never to a key prefix.** The access-policy resource is
`com.cloudflare.edge.r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET_NAME>` — there
is no prefix dimension. Sharing a bucket therefore makes "one token per repo"
meaningless: every token can read and write the whole bucket, so the blast
radius of one leaked credential (or one fork-context injection) is every
repository using that bucket. Bucket count is not a constraint (limit: 1,000,000)
and KB-scale state is inside the free tier either way, so per-repo buckets buy
real isolation at no cost.

Why the owner segment: bucket names are a flat, account-wide namespace, so a
name collision is a real collision. Including the owner moves the collision
surface from "repository name" up to "owner + repository name", which keeps
repositories under different GitHub organisations (or different accounts) apart
even when they share a name. Derivation normalises to R2's rules — lowercase
letters, digits and hyphens only, 3–63 characters, no leading/trailing hyphen —
and falls back to a stable content hash if `owner-repo` would exceed 63 (GitHub
allows repository names up to 100 characters).

Keys inside the bucket mirror the local layout (`state/tasks/…`), since the
bucket name already carries both the owner and repository identity.

- **No object versioning.** Cloudflare R2 has no object-versioning feature
  (verified against the R2 docs and release notes); the nearest capability is
  bucket locks (retention, not history). Consequence: **deletes are not
  revertible**, so `push` deliberately omits `--delete`. Stale lock files on
  the remote are harmless (TTL semantics).
- Sync uses the runner's **preinstalled AWS CLI v2** — no repo dependency, no
  install step. R2 region is `auto`; `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`
  keeps the CLI's default checksum behaviour out of the way.
- **`pull` failure must abort the job** — an empty local `state/` pushed back
  would otherwise destroy the remote state layer.

### One-time setup (per repository)

R2 (Cloudflare dashboard):

1. R2 → **Create bucket** → `loop-state-alex1990-tiny-oss`.
2. R2 → **API → Manage R2 API Tokens → Create API Token** → permission
   *Object Read & Write* → **Specify bucket → `loop-state-alex1990-tiny-oss` only**.
   Do not use "Apply to all buckets", and do not use the global
   *My Profile → API Tokens* page (that is a different system with account-wide
   scope). *Object Read & Write* cannot create, delete or configure buckets and
   is **not accepted by the Cloudflare REST API at all** — it is purely an S3
   credential.
3. Note **Access Key ID**, **Secret Access Key**, and the **Account ID**.

GitHub → Settings → Secrets and variables → Actions.

**Three secrets** (actual credentials — they cannot be inferred from each other):

| Secret | Value |
| --- | --- |
| `R2_ACCESS_KEY_ID` | R2 token access key id |
| `R2_SECRET_ACCESS_KEY` | R2 token secret |
| `DEEPSEEK_API_KEY` | LLM key (DeepSeek platform) |

**One variable** (not a secret — the R2 endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`,
so the account ID is part of an address, and bucket names are not sensitive):

| Variable | Value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |

Optional, with a sane default: `R2_BUCKET` (defaults to the derived
`loop-state-<owner>-<repo>`). The `R2_ACCOUNT_ID` and `R2_BUCKET` lookups fall
back to the same-named secret, so either store works.

**No GitHub credential is configured.** `GH_TOKEN` is `github.token`, generated per
job. A `LOOP_GH_TOKEN` PAT used to live here and must not come back: it would act as
its owner, who is the `Main branch` ruleset's bypass actor — see "Branch protection
is the gate".

```bash
gh secret   set R2_ACCESS_KEY_ID     -R Alex1990/tiny-oss
gh secret   set R2_SECRET_ACCESS_KEY -R Alex1990/tiny-oss
gh secret   set DEEPSEEK_API_KEY     -R Alex1990/tiny-oss
gh variable set R2_ACCOUNT_ID        -R Alex1990/tiny-oss
```

### Adding another repository

Per-repo isolation is structural, so onboarding a repo is copy-and-configure —
no shared infrastructure to extend:

1. Copy `scripts/loop/` and `.github/workflows/loop.yml` into the new repo
   (the loop code lives with the repository it drives).
2. Create bucket `loop-state-<owner>-<repo>` and a token scoped to **that**
   bucket. A different GitHub organisation with a same-named repository gets a
   different bucket automatically.
3. Set the same four items in the new repo (its own token, its own bucket).
   No cross-repo credential is shared.

`R2_PREFIX` and the bucket derivation are already repo-relative, so nothing in
the copied code needs editing.

Seeding the existing A0 state layer (13 files: 3 tasks, 8 runs, metrics,
SUMMARY) — needs an AWS CLI on the seeding machine, because the bucket is
private and `state/` is gitignored (so the runner cannot seed it from a checkout):

```bash
# once, locally
winget install Amazon.AWSCLI        # or the macOS/Linux equivalent

R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
  node scripts/loop/r2-sync.mjs seed   # then `check`
```

Locally the bucket is derived from `package.json`'s `repository` field, so the
name matches what CI will use (`loop-state-alex1990-tiny-oss`); `R2_BUCKET` is
only needed to target a different bucket. A token scoped to one bucket also
proves the scoping worked: `aws s3 ls <endpoint> --endpoint-url <endpoint>`
should be refused.

`seed` (like `push`) omits `--delete`, so it can only add or overwrite.

## A1 acceptance (one week; report boundary ⇒ GitHub stays untouched)

Successor to 05 §8's checklist, rewritten because the drift criterion is
vacuous when nothing is written to GitHub. Source: this file, plus
`state/SUMMARY.md` and the Actions run pages.

Checked items cite the run that proves them. Note on the drift criterion: every
GitHub action proposed while A1 runs at the report boundary stays unexecuted by
design, so a task whose file says `needs-triage` and whose GitHub item has no
label is **expected**, not drift. What must be judged is whether each proposal
was *correct*, and whether new events produce proposals that match reality.

**Observation week closed 2026-09-14** (report boundary, no GitHub writes). The
result that matters is on the safety side: 25 recorded runs, zero `retry` /
`failed` / `aborted`, no drift between GitHub and the state layer — four
consecutive sweeps found the open items and the non-terminal tasks in exact 1:1
agreement — and **no incorrect proposal** against an item the loop did not
control. Cost was flat (triage 58–82k tokens, sweep 60–82k) with no
context-growth drift, and the credential probes measured what the host and the
agent actually hold rather than assuming it.

What the week did *not* prove is that the loop is **complete**, and that is the
honest reason the write path is being landed now: at the report boundary every proposal
was unexecutable, so the write half of the host (`applyActions`,
`planActions`'s `pr-create`, the acceptance gate) never met production. The
unchecked boxes below are exactly that half, and they are the first items to
sample once `auto` is switched on.

- [x] `workflow_dispatch` smoke (`-f smoke=true`): pipeline green end to end
      (checkout → pi install → R2 pull → push) with no agent run — run
      `34509932312`, 51s; re-run `34511261607` also confirmed the seeded state
      layer round-trips (5 tasks / 10 runs / 2 reports / 3 acceptance rows)
- [x] `workflow_dispatch` smoke: a **new** event → run → task file + state
      transition correct, **GitHub unchanged** — run `34511902164`
      (`task=36 stage=triage`, 80,289 tokens): task claimed → `processing` →
      agent triaged → `needs-triage` → task set to `waiting-human` with the
      matching label. Verified against GitHub rather than the run's own report:
      PR #36 has no labels and no label timeline events, and no item in the
      repository carries a loop label written by this run (the single
      `ready-for-human` hit is issue #30, closed on 09-08 during A0).
- [ ] Every route that can run has one real execution on Actions: issue triage ✓
      (`issues.opened` → `r-20260911-121440-v8u6`, #42, 58,304 tokens),
      bugfix-feature, sweep ✓ (`r-20260911-080231-zja0`, 82,107 tokens, from
      `main`), release preflight. **`pr-review` is also unreachable under A1** —
      it requires a loop PR (`loop/<n>-*`), which A1 never produces; note that
      #39/#40/#41 were loop-*related* but not loop-*produced* (head
      `chore/loop-*`), so they routed to `triage`, not `pr-review`. (`deps` and
      external-PR are unrunnable under A1 too — see D28 — and were exercised
      locally during A0; the older reference to sweep run `34511392550` came
      from the pre-merge A0 host.)
- [ ] **The guard holds**: a Dependabot PR and a fork PR both show the loop job
      as *skipped* (not failed), while a same-repo PR and a loop PR still run.
      Verify by pushing to a same-repo branch, and by observing the next
      Dependabot PR arrive.
- [x] Serial lock: two consecutive dispatches queue, never run concurrently —
      verified 2026-09-11 with two `workflow_dispatch` runs 25s apart
      (`34607797259`, `34607838545`). The evidence is at **job** level, not
      workflow: run 2's workflow `created_at` is 14:03:03 but its job
      `created_at` is 14:03:07 — exactly run 1's job `completed_at` — and its
      "Set up job" logs at 14:03:10. Workflow-level `created == started` on both,
      so read alone it would have looked like concurrency; the job timestamps
      show the 4s queue.
- [ ] Crash path: cancel a job mid-run → task stays `processing` → next sweep
      reclaims it by TTL. Still unsampled — and the model-guard runs show why the
      cheap version of this test cannot work: the failure lands in `Install
      engine (pi)`, *before* `Run stage`, so no task is ever claimed (`Pull state`
      and `Run stage` both skipped). It needs a job actually cancelled after
      `entry.mjs` has claimed a task.
- [ ] Failure classification (`retry` vs inbox) — **still unexercised even though
      a failing run now exists.** The D19 guard failure is a *workflow step*
      failure: `entry.mjs` never ran, so no run row was written and the
      classification table was never consulted. Only an in-agent failure (engine
      crash, non-zero exit after a claim) exercises it.
- [ ] Metrics — **unreachable under A1; accepted unverified (2026-09-11)**: a
      human merge writes one `acceptance` row, no duplicates; `released`
      backfills to the intended task. A1 produces no loop PR, so the `metrics`
      decision never fires and all 3 existing rows are A0-era (`manual-local`
      ×2, `workflow-backfill`). D30/D33 cover the *shared* machinery
      (`markTaskTerminal`, the `taskId|event|pr` dedup key) and D33 verified the
      *no-write* half live; the write half (`planActions`) has never executed in
      any host. Validating it needs `execute_writes=true` plus a merged loop PR,
      i.e. leaving the report boundary — deliberately not done during the
      observation week. **First item after the switchover**: confirm the
      first loop-PR merge writes exactly one row.
- [x] Cost readable: `tokens` and `durationMs` land in the end row — real runs
      recorded 102,860 and 77,850 tokens; the install step prints
      `model deepseek-v4-flash is available` and fails the job on a mismatch
- [x] Reports human-readable: the Step Summary alone tells you what happened
      (outcome, exit code, token usage, model, proposed actions) without
      downloading anything
- [ ] Engine stability: N consecutive headless pi runs without hanging — all 18
      **recorded** runs reached an end row with no hang (A0 + A1 combined). Note
      the inverse gap: every recorded run exited 0, so the classification table
      (machine/config failure → `retry`; agent-judged → inbox) has never been
      consulted. The three guard failures do not change this: they die at
      `Install engine (pi)`, before `entry.mjs`, so they write no run row at all
      — see the failure-classification item above. (Distinction worth keeping:
      21 workflow executions, 18 run records.)
- [x] No drift **and** no incorrect proposal for a week → **gate moved to the
      ruleset** (2026-09-15). The loop's safety property is now "nothing reaches
      `main` without a human", enforced by the `Main branch` ruleset rather than by
      scoping a credential: every change arrives through a PR with one approving
      review, the owner is the only bypass actor (and only for merging), and the job
      token carries no `administration` so the loop cannot weaken the rule. See
      "Branch protection is the gate" and "The ruleset, exactly". This replaced an
      earlier two-credential split that a PAT could not have kept honest.

### Not reachable under A1 (structural — decide before the L2 switchover)

Distinct from the unchecked boxes above, which are merely **unsampled** and can
still be earned during the week by manufacturing the event. These cannot be
validated at the report boundary however long it runs:

| Capability | Why it cannot run | Disposition |
| --- | --- | --- |
| `metrics` write path | A1 produces no loop PR, so `handleMetrics` never fires | the switchover makes it reachable; **still unverified — first item once `auto` is on** |
| `pr-review` route | also needs a loop PR; A1 never produces one | reachable after the switchover; exercised in A0, never on Actions |
| External-PR read-only analysis | D28 — a fork/Dependabot `pull_request` run carries no secrets, so not even a read-only analysis can reach the LLM | accepted for A1; needs its own credentials to enable |
| Label/comment effects on GitHub | the report boundary never writes | `auto` executes them; the first such run turns "correct on paper" into "observed" |
| `execute_writes` rehearsal | now runnable — `permissions:` carries the write scopes and the ruleset bounds what they can reach | the code path is exercised locally (push → PR → label, plus the dirty-tree, branch-shape and missing-credential refusals); it has never run on Actions |
| Changing `.github/workflows/**` | the job token has no `workflows` permission and `permissions:` cannot grant one | structural: such tasks route to a human. A PAT would push them **and** inherit the ruleset bypass — see the cost note above |
| R2 bucket versioning | R2 offers no object versioning | accepted deviation from 05 §8 (see Environment facts); `push`/`seed` never use `--delete` |

Consequence for the L2 decision: a clean observation week proves the loop is
**safe**, not that it is **complete**. The write half of the host is the part
that has never met production, which is why the write path lands separately and why
the first `auto` run is a verification step rather than a milestone.

## Defect log

- [x] D9 Terminal tasks reopened on GitHub could not be claimed: with local
      `status=closed/rejected`, `start --task` refused outright even though the
      ops.md trigger map requires reopened → triage, and `start --issue` is
      blocked by the D3 duplicate guard. Now the claim step auto-checks via
      `gh issue view`: GitHub OPEN → reset to `ready` + clear `decision` +
      record `reopened` in the timeline, then allow; GitHub still closed →
      keep refusing (regression: closed+gh=CLOSED refused / closed+gh=OPEN
      allowed).
- [x] D1 `--issue` import did not validate `state == OPEN`: a closed issue / PR
      would also create a task. The real flow only triggers triage on open
      issues → the script should refuse and explain.
- [x] D6 `start` output guidance was weak: the opening ritual requires reading
      AGENTS.md + ops.md + the relevant skill, but the script never printed
      those paths → it should print the three paths together with the runId.
- [x] D3 Re-run after an issue gains details: `start --issue` correctly refuses
      when the task already exists (duplicate guard), but the message did not
      offer the alternative `start --task <n>` → the error should point there.
- [x] D2 `end` required typing the runId by hand; a lost runId could only be
      found via `view` → support `--task <n>` to look up the unfinished run.
- [x] D5 `end` had no coupling check between outcome and stage (a bugfix ending
      `closed` was semantically dubious) → optional guard.
- [x] D4 Help/guidance text still wrote the long `node scripts/loop/run.mjs`
      command and never mentioned `pnpm loop`.
- [x] D8 `syncGithub` stacked contradictory role labels (needs-info +
      ready-for-agent) → strip the other five roles before labelling.
- [x] D10 (A1) `lib/` was gitignored repo-wide (`.gitignore:4`), so a shared
      library under `scripts/loop/lib/` would never have been committed — the
      runner checkout would have crashed on a missing import. Renamed to
      `scripts/loop/shared/` (existing ignore rule left untouched).
- [x] D11 (A1) System-level stages (sweep / retro-scheduled / release preflight)
      have no task file, but the orchestrator demanded a `taskId` → the daily
      sweep crashed every day. `beginRun`/`finishRun`/`buildPrompt` now support
      task-less runs (end row with `taskId: null`, no state transition).
- [x] D12 (A1) `pi` missing on PATH produced a silent EPIPE crash before
      classification; now spawn errors are caught and classified as `retry`.
- [x] D13 (A1) The orchestrator logged nothing about the run outcome, so an
      Actions log gave no answer without opening the Step Summary. Outcome,
      exit code, token count and task transition are now logged.
- [x] D14 (A1) The workflow did not parse at all: job-level `env` referenced
      `runner.temp`, but the `runner` context only exists inside steps. GitHub's
      only signal was a zero-second failed run titled with the file path, so
      `loop.yml` was never registered under its own name. Fixed by moving the
      value to the step that needs it, and by replacing the `inputs.*`
      expression with `github.event.inputs.*` (null on non-dispatch events).
      Now pre-checked with actionlint, which pinpoints the line GitHub omits.
- [x] D15 (A1) Credential/config failures (missing key → pi prints "No models
      available") would have classified as an agent failure and pushed the task
      into the human inbox. They now classify as `retry`.
- [x] D16 (A1) GitHub write actions always used the `gh issue` subcommand, so
      they would have failed on PR tasks ("PRs are a triage surface" means most
      of them). The subcommand is now chosen by `task.kind`.
- [x] D17 (A1) `run.mjs` could not import a PR (`--issue` only), while
      `entry.mjs` handled PRs — so the local coverage exercise could not create
      the task files the A1 sweep expects to find. Added `--pr <n>` (kind `pr`,
      same number space, `OPEN` validation like D1).
- [x] D18 (A1) The job always checked out the default branch, so the manual
      smoke entry could not test this workflow's *own* PR: `main` has no
      `scripts/loop/` yet, and every dispatch died with `MODULE_NOT_FOUND`.
      Default-branch checkout is right for production paths (issues / schedule /
      release / `pull_request_target`, and it is what keeps fork code out of the
      runner), so the fix is narrower: `workflow_dispatch` checks out
      `github.ref`. Dispatch can only target refs in this repository, so the
      safety property is unchanged. Found by a real run before it was
      documented.
- [x] D19 (A1) `LOOP_MODEL` was set to `deepseek/deepseek-flash`, which is not
      in pi's DeepSeek catalogue — the real ids are `deepseek-v4-flash`,
      `deepseek-v4-flash-vision-exp` and `deepseek-v4-pro`. pi **silently falls
      back** on an unknown `--model` instead of failing, so every run would have
      used an unintended model while appearing healthy (the session log records
      `modelId: "deepseek-flash"`, so it was accepted, not corrected). Fixed the
      id, and the install step now validates `LOOP_MODEL` against
      `pi --list-models deepseek` and fails the job on a mismatch. A misspelled
      model name must never be a silent fallback.
- [x] D20 (A1) Three comments still pointed at `scripts/loop/lib/` after the D10
      rename to `shared/`, and `run.mjs` named a `run-stage.mjs` that never
      existed (the orchestrator is `entry.mjs`). Spotted by a real run.
- [x] D21 (A1) The dependabot CI failure was a *reporting* step, not a test
      failure: `Comment coverage on PR` got `gh: Resource not accessible by
      integration (HTTP 403)` because GitHub issues a read-only `GITHUB_TOKEN`
      to Dependabot-triggered runs. An earlier note here claimed `permissions:`
      could not lift that — wrong: that is the **fork** rule. Dependabot runs
      *can* be widened, and the official docs name `permissions` as the fix.
      The `test` job now declares `contents: read` + `pull-requests: write`, so
      a Dependabot PR no longer shows a red CI whose tests all passed.
- [x] D22 (A1) `renderSummary` had no section for `status: new`, so a task the
      sweep had just created was invisible in the human summary — the one item
      most in need of attention. Reported by a real sweep run; a `Unprocessed (new)`
      section now lists them.
- [x] D23 (A1) System-level runs had no outcome vocabulary of their own. The
      first real sweep recorded `closed`, which in the task vocabulary means
      "closed without a PR, excluded from the acceptance denominator" — retro
      reading end rows would have counted sweep/retro executions as closed
      tasks. System runs now use `completed / failed / retry / aborted`, and
      `finishRun` rejects a task-scoped outcome for a task-less run.
- [x] D24 (A1) `D18`'s fix covered `workflow_dispatch` but not `pull_request`,
      which still checked out the default branch — so a `pr-review` run could
      never see the code it was asked to review, and every `pull_request` run on
      the A1 PR itself died with `MODULE_NOT_FOUND`. Checkout is now keyed on
      trust: `workflow_dispatch` → `github.ref`; **same-repo** PR → its head
      branch (only OWNER/MEMBER/COLLABORATOR can push those, and this is what
      makes loop's own `loop/<n>-*` PRs reviewable); everything else → the
      default branch, which is where fork PRs land so external code is never
      checked out. Verified across seven event shapes.
- [x] D25 (A1) Decisions that produce *no* run were logged only into the Step
      Summary, so the Actions log showed a route line and then nothing — a skip
      was indistinguishable from a silent failure. Every path (skip, inbox
      no-op, inbox-only, duplicate event, no-op route) now logs its reason.
- [ ] D26 (A1, open) A `pull_request.synchronize` on a PR task is skipped whenever
      its state is not claimable, so a PR that gains a commit is never re-analysed
      or re-reviewed. Two faces, both observed on real PRs:
      - `waiting-merge`: a loop PR that receives a new commit is skipped instead of
        re-reviewed, so `review_requested`-style re-entry has no path back.
      - `waiting-human`: **observed live on #39** — the first push opened the PR and
        triaged it to `waiting-human`; the second push logged
        `skip: task #39 not claimable (status=waiting-human)`. Every later push is
        skipped too, so the task's analysis is frozen at whatever the first
        revision looked like.

      This is a real consequence of running at the report boundary: `flows` §2a
      describes request-changes → `processing` → re-review on `synchronize`, but a
      report-boundary `pr-review` cannot comment or relabel, so it can only land in
      `waiting-human` — where nothing re-enters. Left open deliberately: A1's week
      should quantify how often this bites (it will have hit every loop PR by then),
      and the fix is a design choice — re-open the task on `synchronize` for PR
      kinds, or add a bounded re-triage — not a one-line guard.
- [x] D27 (A1) `run.mjs`'s subcommands did not catch errors thrown by the shared
      library, so `pnpm loop start --task <missing>` printed a full Node stack
      trace instead of a one-line reason — the library throws (correct for the
      orchestrator, which needs the failure) while a CLI should not. `main` now
      wraps dispatch, so every subcommand reports the same way. Found while
      reviewing the translated error messages.
- [ ] D28 (A1, open) Both `pull_request` rows that need no write access are
      nevertheless unrunnable, because the platform withholds **all** secrets
      (not just write permission) from Dependabot-triggered runs and from fork
      PRs: even read-only analysis needs the LLM key, and `deps` needs the R2
      credentials. The job-level guard skips them (see the trigger section) so
      they fail visibly *before* wasting a runner rather than after pulling
      state. Options when A1's week is over: a `pull_request_target` two-step
      where only this repository's scripts run (§6's design), or Dependabot
      secrets for `deps`. Chosen for A1: neither — the week is for validating
      the run contract, and the guard keeps the red/green signal honest.
- [x] D29 (A1) D9's reopen check fired on **any** non-claimable status, not just
      the terminal ones. A `waiting-human` task (the inbox) is open on GitHub by
      definition, so a single `start --task` "reopened" it: the status was reset
      to `ready`, the triage decision was **wiped**, and a bogus `reopened` event
      was appended — silently converting an inbox item into an auto-claimable one
      and bypassing the cognitive guard. `waiting-merge` was affected the same
      way. The README entry for D9 always said `closed/rejected`; the
      implementation was broader than its own description. The check is now
      limited to `closed`/`rejected`, and the not-claimable error tells you what
      the state actually requires (inbox → a human decides first; waiting-merge →
      awaiting merge). Verified across five scenarios: inbox and awaiting-merge
      are refused without touching the decision, `closed` + a genuinely reopened
      GitHub item is still let through, and `closed` + a closed item is not.
- [x] D30 (A1) Gate events recorded the acceptance row but never moved the task:
      `handleMetrics` appended to `metrics/acceptance.jsonl` and returned, so a
      loop PR that merged was counted for the auto-acceptance rate while its task
      stayed in `waiting-merge`. That contradicts the state machine ops.md
      defines (`waiting-merge → accepted | rejected`), and sweep cannot repair it
      — sweep reconciles by listing *open* GitHub items, which by construction
      cannot see a closure. Any loop PR merged unattended would have stranded its
      task under "Awaiting human merge" permanently. `handleMetrics` now also
      applies the transition via `markTaskTerminal` (merged → `accepted`,
      closed-unmerged → `rejected`) and refreshes `SUMMARY.md`. The two effects
      are idempotent independently — the row on `taskId+event+pr`, the task on
      its own status — so a crash between them is repaired by a repeated event
      rather than leaving a permanent inconsistency. Verified: both directions,
      duplicate events, a non-`waiting-merge` originating state (recorded as
      `(was …)` so an unexpected route is visible), `released` leaving the status
      alone, and a missing task not throwing.
- [x] D31 (A1) `renderSummary` named two different things: the shared library's
      exporter writes `state/SUMMARY.md`, while `entry.mjs`'s local function
      renders the Actions Step Summary. Importing the former alongside the latter
      was a `SyntaxError` at module load — the orchestrator would not start. The
      real problem is the name, not the collision, so they are now
      `renderStateSummary` (state layer) and `renderStepSummary` (Actions UI,
      paired with the existing `writeStepSummary`). Terminal-state lists, which
      had also been written out inline in more than one place, are now the single
      exported `TERMINAL_STATUSES` — duplicated lists are this codebase's
      recurring failure mode.
- [ ] D32 (A1, open — not yet reachable) The acceptance dedup key is
      `taskId|event|pr`, but sweep's mandate (docs + `skills/sweep/SKILL.md`) is
      to rewrite a *missed* event "labelled `sweep-corrected`". Read literally
      that means writing `event: "sweep-corrected"`, which changes the key and
      therefore appends a **second** row for the same closure — double-counting
      the PR in the auto-acceptance rate, which is the one number retro exists
      to produce. Not yet triggerable: no sweep implementation writes it today.
      The fix when sweep lands is to keep the original `event` value and mark
      the row through the existing `writer` field (`writer: "sweep-corrected"`),
      so dedup still matches. Recorded now because the ambiguity is in the norms
      layer, and whoever implements the backfill will read that sentence first.
- [x] D33 (A1) A non-loop PR closing left its task stranded. `pull_request_target`
      returned `noop` for any PR without `loop-task:`, which is right about the
      **metric** (not loop-produced ⇒ never in the acceptance rate) but wrong
      about the **task**: ops.md maps "(none, merged) → accepted" and "(none,
      closed unmerged) → rejected" regardless of provenance. Every owner PR gets a
      task from `pull_request` triage, so each merge left a zombie in
      `waiting-human` — the task for the very PR that fixed D30 (#39) showed it
      live — visible forever under "Inbox" in SUMMARY.md and, in general,
      uncorrectable by sweep, which lists *open* GitHub items and so cannot see a
      closure. (Dependabot PRs are skipped before triage by the credential guard
      (D28), so for them the new branch is a no-op; it still matters if D28 is
      ever lifted, and it correctly terminalises the older dependabot task #35.)
      The router now emits a `terminal` decision for that case; the entry handles
      it through the same `markTaskTerminal` as the metrics path, so "what
      terminal means" has one definition, and the acceptance row is still never
      written for a non-loop PR.
      Verified live twice on 2026-09-11: (`34595150462`, PR #40 merged) `task
      #40: waiting-human → accepted`, R2 then reporting `closed=1 accepted=9`
      with acceptance rows still at 3; and (`34597417493`, PR #41 merged) the
      same transition for `#41`. No metric row either time — which is the
      point.
      The #39 instance was **not** this fix's doing: the drift was self-healed by
      the 09-11 daily sweep (`r-20260911-080231-zja0`), which only found it
      because the #40 triage report had mentioned it in passing. That is the
      accidental path D30/D33 exist to remove.
- [x] D34 (A1) `Push state to R2` failed whenever `Pull state from R2` was
      skipped. The push is `if: always()` so that a run which crashes or times
      out still records its `processing` state for the next sweep — but
      `state/` is gitignored and materialises only from a pull, so when an
      earlier step fails there is no directory to upload and the step dies on
      `aws: [ERROR]: The user-provided path ... does not exist` (exit 255,
      observed on `34607797259` and `34607838545`, both after the D19 model
      guard rejected a deliberately bad model). The job was already failing, so
      the verdict was unchanged — but a second red step buries the first cause
      and reads like R2 itself broke, which is exactly the kind of noise a
      report-only phase must not generate while a human is reading logs daily.
      Now the pull has an `id` and the push is conditioned on
      `always() && steps.pull.outcome != 'skipped'`. Deliberately not
      `== 'success'`: a *failed* pull may still leave a usable tree, and
      recording post-crash state is the whole point of `always()`.
      Verified on `34608064576` (same bad model after the fix): step 9 is now
      `skipped` while step 6 stays `failure`, so the only red step is the one
      that actually failed.

- [x] D35 (#71) The `pr-review` stage claimed two isolated reviewers but ran one
      `pi` process in one session, so both lenses shared a context and a model —
      the isolation `skills/review/SKILL.md` promised was nominal. pi has no
      sub-agent mechanism, so the promise was unfulfillable as written. The host
      now launches two `pi` processes for `pr-review` (`shared/review.mjs`): separate
      `--session-dir`, a different `--model` for the second lens, and a read-only
      `--tools read,grep,find,ls,bash` allowlist; `mergeReviews` accepts only when
      both approve and never counts a missing verdict as approval. The skill was
      reworded to describe the host mechanism instead of telling the agent to spawn
      sub-agents. Demonstrated with a fake-engine harness: two invocations, distinct
      session dirs and models, both carrying the allowlist, and the accept/reject/
      inconclusive merge paths.
- [x] D36 (#73) A loop PR was defined by identity only (`loop/<n>-*` plus the
      `Closes`/`loop-task` markers), so nothing an agent's discarded context had
      held — intent, proof, risk tier, review focus — reached the reviewer, who was
      the first human to read the change. The contract now requires four author
      sections in the PR body (`docs/norms/ops.md` "The loop PR contract"):
      `validatePush` refuses a `pr-opened` whose body is missing any of them, the
      maker prompt renders the exact template, and `skills/review/SKILL.md` makes
      absence a `request-changes` gate before line-level review. The four headings
      live in `PR_CONTRACT_SECTIONS` (`shared/state.mjs`) and the maker prompt imports
      them, so the check and the template cannot drift.

## Environment facts

- **Double review (#71):** `pr-review` runs two isolated `pi` processes
  (`shared/review.mjs`) — separate session dirs, different models, read-only tools —
  and merges their verdicts. `LOOP_REVIEW_MODEL` overrides the second model;
  without it the host picks the first DeepSeek catalogue entry that is not
  `LOOP_MODEL` (default: `deepseek-v4-flash` → `deepseek-v4-pro`).
- Phase (2026-09-10): **A1 implementation landed; A0 remains the running host
  until the 2026-09-15 switchover.** Write boundary in A1 = `report`.
- Engine: pi (verified) for A1; A0 runs were driven by an interactive opencode
  session (`omp`). `LOOP_ENGINE_CMD` overrides the engine command.
- **Engine install measured on the runner (2026-09-10)**: `npm i -g
  @earendil-works/pi-coding-agent@0.85.1` → `added 132 packages in 6s`,
  `pi --version` → `0.85.1`. Well inside the job budget.
- **First real end-to-end run (2026-09-10, run 34509379949, 3m05s, all steps
  green)**: R2 pull and push both worked against `loop-state-alex1990-tiny-oss`
  (bucket name derived correctly from `GITHUB_REPOSITORY`); the agent completed a
  system-level triage, wrote its report and `result.json`, and consumed 102,860
  tokens.
  - **Report boundary held.** Verified independently rather than from the run's
    own summary: PRs #21/#35 still carry no loop label, #21/#35 have zero
    comments, and no item in the repository carries `needs-triage`. Everything
    the agent wanted to do arrived as a proposal checklist in the report.
  - pi's built-in DeepSeek catalogue (credential-gated, printed per run):
    `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `deepseek-v4-pro`.
    There is no `deepseek-flash` — see D19. `LOOP_REVIEW_MODEL` defaults to a
    different entry from this catalogue so the second reviewer lens is heterogeneous.
- **Infrastructure smoke**: `gh workflow run loop.yml -f smoke=true` exercises
  checkout → toolchain → pi install → R2 pull → push and **skips the agent
  entirely**, so "is the pipeline healthy?" is answerable without spending
  tokens or waiting on an LLM. Use it first when onboarding a repository or when
  a credential is suspected to have stopped working. Note that an empty `stage`
  does **not** produce a cheaper run: GitHub applies the input's `default:`
  (`triage`), which starts a real system-level triage — the first smoke of this
  workflow cost 102,860 tokens that way, which is why this switch exists.
- `gh` works from this machine (list/view in seconds); the older note about
  direct GitHub timeouts and a stopped proxy is stale.
- AWS CLI **v2 is now installed locally** (`C:\Program Files\Amazon\AWSCLIV2`),
  matching the runner. Note that a `pip install awscli` does **not** work for
  this: it produces a `.cmd` shim, which Node refuses to spawn on Windows
  (`spawnSync aws ENOENT`), whereas v2 ships a real `aws.exe`. Open a new
  terminal after installing so PATH picks it up.
- Workflow edits can be pre-checked locally with
  [`actionlint`](https://github.com/rhysd/actionlint) (a bad `runner` context in
  job-level `env` is a parse failure GitHub only reports as "workflow file
  issue", with no line number).
