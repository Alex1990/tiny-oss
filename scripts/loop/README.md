# scripts/loop — local manual host (A0 trial period)

## Overall purpose (owner directive, 2026-09-08)

> From here on, all work exists to **improve the Loop**. Every task (real issue,
> synthetic case, smoke test) is a vehicle for polishing the Loop: validating
> the run contract, exposing tool/skill/process defects, and distilling rules.
> Task completion is a byproduct; a better Loop is the acceptance criterion.

Accordingly, at the end of every trial run, ask yourself: what Loop defect or
improvement did this round expose? → record it in the list below or fix it
directly in this directory's files.

## Daily commands
```bash
pnpm loop start --issue <n>                 # import a real issue + claim (stage defaults to triage)
pnpm loop start --task <n> [--stage <s>]    # claim an existing task (use this to re-run after waiting-info is answered)
pnpm loop start --new --title "..."         # local synthetic task
pnpm loop checkpoint --run <r-xxx> --note "..."   # process checkpoint
pnpm loop end --run <r-xxx> --outcome <o> [--comment ".."] [--label <name>] [--no-github]
pnpm loop summary | view                    # summary / task list
```

## Real remote flow (owner expectation, finalized and implemented 2026-09-08)

When handling a real issue, `end` writes back to GitHub automatically
(`run.mjs` `syncGithub`):

- **Labels are applied automatically**: outcome → one of the five role labels
  (`triaged`→`ready-for-agent`, `needs-info`→`needs-info`,
  `needs-triage`/`failed`→`needs-triage`, `pr-opened`→`ready-for-human`;
  `closed` may take `--label wontfix` etc.).
- **Info needing human confirmation is commented straight into the issue**:
  `end --comment "…body…"` posts a comment; with `outcome=closed` that text is
  used as the closing reason (`gh issue close --comment`).
- Local synthetic tasks (no url) skip GitHub writes automatically;
  `--no-github` forces a skip; gh write failures only warn and never roll back
  local state.

## Full closed-loop flow (owner finalization, 2026-09-08)

> After the agent changes code it **reviews its own work**, then commits, pushes
> and opens a PR; human review feedback lands as PR comments; changes requested
> → the agent keeps amending; approved → the human merges.

Steps inside a feature/bugfix run (maker=agent):

1. Make the change → `verify` skill until all five gates are green → `review`
   skill (dual review; when no second agent is available, self-review + human
   final call)
2. `git checkout -b loop/<issueNo>-<slug>` → commit (body contains `Closes #<n>`) → push
3. `gh pr create` (body contains `Closes #<n>` + `loop-task: #<n>` +
   requirement/changes/verification)
4. `end --outcome pr-opened --pr <prNo>` → auto-labels `ready-for-human` +
   records task.prs
5. Human comments on the PR; request-changes → claim `--task <n>` to keep
   amending → commit/push (the PR auto-updates) → loop; approve → human merges
   → the evaluation chain records accepted

Write boundary (upgraded 2026-09-08): **opened up to commit/push/open-PR +
labeling/commenting**; merging PRs / npm publishing stay human (the cognitive
guard is unchanged).

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

All fixed and regression-tested on 2026-09-08 (synthetic tasks + read-only
trials on #27/#28). Also fixed: D8 (syncGithub strips stale role labels before
labeling, preventing needs-info+ready-for-agent stacking). Added: a
stage→outcome whitelist (`STAGE_OUTCOMES`; unknown stages pass everything).

## Environment facts (A0 related)
- Phase (2026-09-08): **manual execution period** — no automatic triggers; a
  human launches every run; after receiving instructions the agent executes per
  ops.md + the relevant skill (this session = the engine). Check
  `state/SUMMARY.md` and `state/runs/` daily; run one sweep/retro exercise
  weekly to distill rules.

- Engine = this session (opencode omp); gh is authenticated (Alex1990,
  repo+workflow scope).
- Direct GitHub connections are unstable (timeouts happened); the proxy
  127.0.0.1:10809 is not running.
- Open issue is now #28 (PR #29 under review); triage/feature wrap-ups write to
  GitHub automatically.
- Write boundary (closed-loop version, 2026-09-08): real issues get automatic
  labeling + commenting + commit/push/open-PR; merging PRs and npm publishing
  stay human.
