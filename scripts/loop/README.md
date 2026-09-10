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
| `auto` | Executes labels/comments/close (the A0 closed-loop boundary; L2 default, and the rehearsal mode). |

In `report` mode the pending actions are appended to `state/reports/<runId>.md`
as a checklist and surfaced in the Actions Step Summary, so a human can execute
them by hand.

## A1 architecture (Actions + R2)

```
GitHub event ─▶ loop.yml (concurrency group `loop` = platform-level single writer)
                 ├─ setup node/pnpm ▸ install pi ▸ print `pi --list-models deepseek`
                 ├─ r2-sync pull        (state layer → job-local state/)
                 ├─ entry.mjs           (route → inbox | metrics | run)
                 ├─ r2-sync push        (if: always())
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
| dependabot PR (author `dependabot[bot]` or head `dependabot/*`) | run(deps) |
| external PR (author_association ∉ OWNER/MEMBER/COLLABORATOR) | run(triage, readonly) |
| `pull_request_review` on a loop PR | run(pr-review) |
| `pull_request_target` closed (loop PR) | metrics: merged / closed-unmerged |
| `release` published | metrics: released |
| `schedule` daily / weekly | system run: sweep / retro-scheduled |
| `workflow_dispatch` | run per inputs (`task`/`stage`); `execute_writes=true` = L2 rehearsal |

Anything else is a no-op that still exits 0 — event storms cost nothing.

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

- [ ] `workflow_dispatch` smoke (`-f smoke=true`): pipeline green end to end
      (checkout → pi install → R2 pull → push) with no agent run
- [ ] `workflow_dispatch` smoke: real issue → triage run → task file + state
      transition correct, **GitHub unchanged**
- [ ] Every route has one real execution: issue triage / bugfix-feature / deps /
      external-PR readonly / sweep / release preflight
- [ ] Serial lock: two consecutive dispatches queue, never run concurrently
      (run timestamps prove it)
- [ ] Crash path: cancel a job mid-run → task stays `processing` → next sweep
      reclaims it by TTL
- [ ] Metrics: a human merge writes one `acceptance` row, no duplicates;
      `released` backfills to the intended task
- [ ] Engine stability: N consecutive headless pi runs without hanging; exit-code
      mapping matches the failure-classification table
- [ ] Cost readable: every run's `tokens`/`durationMs` land in the end row; the
      `pi --list-models deepseek` line confirms the real model id
- [ ] Reports human-readable: the Step Summary alone tells you what happened,
      without downloading anything
- [ ] State layer and GitHub show no drift after a week → human decides on L2

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
- [ ] D21 (proposed by a real run, not yet implemented) The dependabot CI
      failure is a *reporting* step, not a test failure: `Comment coverage on
      PR` gets `gh: Resource not accessible by integration (HTTP 403)` because
      GitHub forces the token read-only for Dependabot-triggered workflows.
      `permissions:` cannot lift that. Needs a maintainer decision (guard the
      step, `continue-on-error`, or move it to a `pull_request_target` job).

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
- No `rclone` and no `aws` CLI on this Windows box — R2 sync is runner-side only;
  local seeding needs an AWS CLI installed first.
- Workflow edits can be pre-checked locally with
  [`actionlint`](https://github.com/rhysd/actionlint) (a bad `runner` context in
  job-level `env` is a parse failure GitHub only reports as "workflow file
  issue", with no line number).
