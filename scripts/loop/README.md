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
| `auto` | Executes labels/comments/close (the A0 closed-loop boundary; L2 default, and the rehearsal mode). Note this is *permission* to write, not *ability*: with `LOOP_GH_TOKEN` unset, `auto` still cannot write — see the credential section below. |

In `report` mode the pending actions are appended to `state/reports/<runId>.md`
as a checklist and surfaced in the Actions Step Summary, so a human can execute
them by hand.

### GitHub write credential (`LOOP_GH_TOKEN`, unset today)

`GH_TOKEN: ${{ secrets.LOOP_GH_TOKEN || github.token }}`. The secret is
**deliberately not configured**: `github.token` is capped by the workflow's
`permissions: {contents: read, issues: read, pull-requests: read}`, so today a
run that ignores its prompt and calls `gh pr merge` gets a 403. Two independent
locks, and the platform one does not depend on the model behaving.

Configuring the secret lifts only the platform lock — `writeLevel` still gates
`applyActions` in `state.mjs`, and its default is `report`, so ordinary runs
keep reporting. What *does* change: the agent subprocess inherits
`env: process.env` (`shared/agent.mjs`), so a PAT reaches it and the only thing
left between the agent and a write is the prompt. That is the trade, and it is
why the scope below matters.

**Do not grant the agent's credential `Contents: write`.** Merging a PR is not
under "Pull requests" — it is under "Contents" (GitHub's endpoint→permission
table):

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
2. **"Can open a PR" and "can merge a PR" are the same permission** — within a
   single credential. Opening a PR needs a head branch; creating one needs
   `Contents: write`; and that is the merge permission. Separating them means
   splitting the *roles*, which is what L2c below does.

So the L2 step has three sizes rather than two. Two are pure scope choices; the
third is the one that satisfies "loop may open PRs but must never merge them",
and it needs a small host change.

| | Scopes / changes | Loop can | Loop cannot |
| --- | --- | --- | --- |
| **L2a** | `Issues: RW` + `Pull requests: RW` + `Contents: read` | label, comment, close, review | open PRs, merge, touch code or branches |
| **L2c** | L2a, **plus** the host pushes `loop/*` branches with its own token | label, comment, close, review, **open PRs** | **merge anything** |
| **L2b** | L2a + `Contents: RW` on the loop's own credential | everything, PR creation included | — (nothing; this is the unchecked size) |

Prefer a **fine-grained** PAT scoped to `Alex1990/tiny-oss`; a classic `repo`
token grants all of the above at once, defeating the point. Set an expiry and
record who renews it, or L2 fails silently later.

#### L2c — the loop opens PRs and still cannot merge

Worth stating up front: **a single credential cannot express this.** Opening a
PR needs a head branch, creating one needs `Contents: write`, and that is the
same permission `PUT /pulls/{n}/merge` requires. The split has to happen across
*roles*, not inside one scope list:

| Credential | Held by | Scopes | Used for |
| --- | --- | --- | --- |
| `GITHUB_TOKEN` (job) | the workflow's own steps | `contents: write` | creating and pushing the `loop/<n>-*` branch |
| `LOOP_GH_TOKEN` (PAT) | the agent subprocess | `Issues: RW`, `Pull requests: RW` — **no `Contents`** | labels, comments, opening the PR |

Two details are required and both are easy to miss:

- `actions/checkout` must set **`persist-credentials: false`**. Its default is
  `true` and writes the job token into the repository's git config so scripts
  can run authenticated git commands — which would hand the agent exactly the
  `Contents: write` this design exists to remove.
- Pushing is the *only* thing that has to move to a host step. Committing is a
  local operation with no network credential, so the agent can still stage and
  commit its work in the workspace; the host pushes the branch and opens the PR
  from the agent's proposed metadata. That also fits the existing division of
  labour — the agent proposes, the host executes.

Result: the agent has no route to `PUT /pulls/{n}/merge` (403 — no `Contents`),
and no route to push anything anywhere. The loop still produces PRs. `no
self-merge` becomes a platform guarantee instead of a prompt instruction, which
is the whole point.

One side effect to plan for: a PR created with `GITHUB_TOKEN` produces a
`pull_request` event whose workflow runs start in an **approval-required** state
(except `closed`/`labeled`/`edited`, which do not create runs at all). So the
loop will not triage or review its own PR, and CI will not run on it, until a
human clicks "Approve workflows to run". For this loop that is a feature — it
removes the recursive self-review the `pr-review` route would otherwise perform
on the loop's own output, and it matches D26's direction. A human merging the PR
still fires `pull_request_target.closed` normally, which is what drives the
`metrics` gate.

Server-side protection does **not** substitute for any of this: this is a solo
repository (one collaborator, `admin: true`), so a ruleset requiring approvals
would block the owner's own PRs forever (GitHub forbids self-approval), and
adding an admin `bypass_actor` would let the loop's PAT bypass it too. The
existing `Main branch` ruleset is `enforcement: disabled` and contains only
`deletion` and `non_fast_forward` — it never restricted merging. The guarantee
has to come from the credential split.

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
- **pi has no built-in permission gating** (verified). The job's `permissions:`
  block and the absence of secrets in fork contexts are the whole boundary —
  do not add write credentials to a job that touches untrusted input.
- **One writer for closing:** the agent writes `state/reports/<runId>.result.json`;
  `entry.mjs` performs the transition via `finishRun`. Agents never run
  `pnpm loop end` themselves.
- **Sessions:** only the aggregate lands in the state layer (run `end` row:
  `tokens`/`durationMs`/`model`/`outcome`); full transcripts go to the
  artifact store (90 days).

### Trigger → action (workflow)

| Event | Action |
| --- | --- |
| `issues` opened/reopened | run(triage) |
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

Optional, with sane defaults: `LOOP_GH_TOKEN` (fine-grained PAT; unused while
report-only, since `github.token` covers read access) and `R2_BUCKET` (defaults
to the derived `loop-state-<owner>-<repo>`). Both the `R2_ACCOUNT_ID` and
`R2_BUCKET` lookups fall back to the same-named secret, so either store works.

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
      any host. Validating it needs `LOOP_GH_TOKEN` plus `execute_writes=true`,
      i.e. leaving the report boundary — deliberately not done during the
      observation week. **First item after the L2 switchover**: confirm the
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
- [ ] No drift **and** no incorrect proposal after a week → human decides on L2.
      Owner's target is **L2c**: the loop opens PRs but can never merge. That
      needs the credential split (host pushes branches with `GITHUB_TOKEN`; the
      agent's PAT carries no `Contents`) plus `persist-credentials: false` — see
      "GitHub write credential" above for the endpoint-level evidence, and note
      that a single credential cannot express it.

### Not reachable under A1 (structural — decide before the L2 switchover)

Distinct from the unchecked boxes above, which are merely **unsampled** and can
still be earned during the week by manufacturing the event. These cannot be
validated at the report boundary however long it runs:

| Capability | Why it cannot run | Disposition |
| --- | --- | --- |
| `metrics` write path | A1 produces no loop PR, so `handleMetrics` never fires | accepted unverified; first item at L2 |
| `pr-review` route | also needs a loop PR; A1 never produces one | untested here — exercised in A0 |
| External-PR read-only analysis | D28 — a fork/Dependabot `pull_request` run carries no secrets, so not even a read-only analysis can reach the LLM | accepted for A1; needs its own credentials to enable |
| Label/comment effects on GitHub | the report boundary never writes | proposals must be judged on *correctness*, not on effect |
| `execute_writes` rehearsal | `LOOP_GH_TOKEN` is unset, so `auto` cannot write even when requested | correct as defence in depth — but it means **no write path has ever executed**. Configuring the PAT is a prerequisite for testing any of it; see "GitHub write credential" |
| R2 bucket versioning | R2 offers no object versioning | accepted deviation from 05 §8 (see Environment facts); `push`/`seed` never use `--delete` |

Consequence for the L2 decision: a clean observation week proves the loop is
**safe**, not that it is **complete**. The write half of the host is the part
that has never met production.

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

## Environment facts

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
    There is no `deepseek-flash` — see D19.
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
