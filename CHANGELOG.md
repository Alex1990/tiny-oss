# Changelog


## v1.2.0

[compare changes](https://github.com/Alex1990/tiny-oss/compare/v1.1.0...v1.2.0)

### 🚀 Enhancements

- Add Volcano Engine TOS provider entry ([d15d021](https://github.com/Alex1990/tiny-oss/commit/d15d021))

### 🩹 Fixes

- Include CHANGELOG.md in the release commit ([5646c15](https://github.com/Alex1990/tiny-oss/commit/5646c15))

### 📖 Documentation

- Document the release flow for future maintainers ([31c17cb](https://github.com/Alex1990/tiny-oss/commit/31c17cb))
- Replace supported providers list with a table of contents ([e4ab41f](https://github.com/Alex1990/tiny-oss/commit/e4ab41f))
- Adopt loop norms (AGENTS.md, docs/agents, skills) ([e3c4cd6](https://github.com/Alex1990/tiny-oss/commit/e3c4cd6))
- Translate scripts/loop/README.md to English ([477d138](https://github.com/Alex1990/tiny-oss/commit/477d138))
- Extend needs-info close window from 7 to 30 days ([151d561](https://github.com/Alex1990/tiny-oss/commit/151d561))
- **loop:** Flag an acceptance double-counting hazard (D32) ([807bf52](https://github.com/Alex1990/tiny-oss/commit/807bf52))
- **loop:** Record the live PR-resynchronisation skip (D26) ([fd43cda](https://github.com/Alex1990/tiny-oss/commit/fd43cda))
- **loop:** Note the unattributed-approval ruleset default ([65071c3](https://github.com/Alex1990/tiny-oss/commit/65071c3))
- **loop:** Approving a loop PR's runs one at a time is the better default ([9929d03](https://github.com/Alex1990/tiny-oss/commit/9929d03))
- Add conventional status badges to the READMEs ([35c7312](https://github.com/Alex1990/tiny-oss/commit/35c7312))

### 🏡 Chore

- Add local loop host for manual A0 trials ([da28a14](https://github.com/Alex1990/tiny-oss/commit/da28a14))
- Support claiming reopened GitHub issues (D9) ([f236b76](https://github.com/Alex1990/tiny-oss/commit/f236b76))
- **loop:** Add Actions + R2 host for stage A1 (report-only) ([ec85a18](https://github.com/Alex1990/tiny-oss/commit/ec85a18))
- **loop:** Repair workflow contexts that broke parsing ([da75c9c](https://github.com/Alex1990/tiny-oss/commit/da75c9c))
- **loop:** Keep credential failures out of the human inbox, log outcomes ([ede64a0](https://github.com/Alex1990/tiny-oss/commit/ede64a0))
- **loop:** Target the right gh subcommand, import PRs locally ([51661b9](https://github.com/Alex1990/tiny-oss/commit/51661b9))
- **loop:** Shrink R2 configuration to three secrets ([ddbeb9a](https://github.com/Alex1990/tiny-oss/commit/ddbeb9a))
- **loop:** Derive one R2 bucket per repository ([d71b6f6](https://github.com/Alex1990/tiny-oss/commit/d71b6f6))
- **loop:** Include the owner in the derived bucket name ([35d0fd3](https://github.com/Alex1990/tiny-oss/commit/35d0fd3))
- **loop:** Let workflow_dispatch check out its own ref ([64ead08](https://github.com/Alex1990/tiny-oss/commit/64ead08))
- **loop:** Correct the model id, validate it, add an infrastructure smoke ([d6d526a](https://github.com/Alex1990/tiny-oss/commit/d6d526a))
- **loop:** Render system-level runs correctly in SUMMARY ([faf6d09](https://github.com/Alex1990/tiny-oss/commit/faf6d09))
- **loop:** No pager, bounded timeouts, and a readable smoke ([2a7797e](https://github.com/Alex1990/tiny-oss/commit/2a7797e))
- **loop:** Give system-level runs their own outcome vocabulary ([1611f76](https://github.com/Alex1990/tiny-oss/commit/1611f76))
- **loop:** Record A1 acceptance progress with run evidence ([1ab3354](https://github.com/Alex1990/tiny-oss/commit/1ab3354))
- **loop:** Verify the task-scoped path on Actions ([f837d6d](https://github.com/Alex1990/tiny-oss/commit/f837d6d))
- **loop:** Check out the PR's code for same-repo PRs ([5451e88](https://github.com/Alex1990/tiny-oss/commit/5451e88))
- **loop:** Log every decision that produces no run ([de050ad](https://github.com/Alex1990/tiny-oss/commit/de050ad))
- **norms:** Add the commit-message convention ([9ab6fd1](https://github.com/Alex1990/tiny-oss/commit/9ab6fd1))
- **loop:** Translate the loop host to English ([3c9cfac](https://github.com/Alex1990/tiny-oss/commit/3c9cfac))
- **loop:** Fix a stale path in the cron comment ([f079d72](https://github.com/Alex1990/tiny-oss/commit/f079d72))
- **loop:** Wire the weekly retro schedule ([1df565f](https://github.com/Alex1990/tiny-oss/commit/1df565f))
- **loop:** Fix the dependabot CI failure, guard runs that lack secrets ([f11a55e](https://github.com/Alex1990/tiny-oss/commit/f11a55e))
- **loop:** Limit the D9 reopen check to terminal states ([723aacc](https://github.com/Alex1990/tiny-oss/commit/723aacc))
- **deps-dev:** Bump hono from 4.12.34 to 4.13.5 ([88d54e1](https://github.com/Alex1990/tiny-oss/commit/88d54e1))
- **loop:** Move tasks to terminal states on GitHub gate events ([2d104af](https://github.com/Alex1990/tiny-oss/commit/2d104af))
- **loop:** Terminalise the task of a non-loop PR when it closes ([05cbfb6](https://github.com/Alex1990/tiny-oss/commit/05cbfb6))
- **loop:** Correct the D33 note (dependabot PRs never reach triage) ([fcb23ff](https://github.com/Alex1990/tiny-oss/commit/fcb23ff))
- **loop:** Record what A1 structurally cannot validate ([025a82b](https://github.com/Alex1990/tiny-oss/commit/025a82b))
- **loop:** Let workflow_dispatch override the engine model ([4f72802](https://github.com/Alex1990/tiny-oss/commit/4f72802))
- **loop:** Do not push state when the pull never ran ([8e2282b](https://github.com/Alex1990/tiny-oss/commit/8e2282b))
- **loop:** Record the D34 verification run ([3019498](https://github.com/Alex1990/tiny-oss/commit/3019498))
- **loop:** Record the write-credential scope decision (does PR write include merge?) ([a6c46f0](https://github.com/Alex1990/tiny-oss/commit/a6c46f0))
- **loop:** Record L2c — the loop opens PRs and still cannot merge ([92fdfa2](https://github.com/Alex1990/tiny-oss/commit/92fdfa2))
- **loop:** Measure the GitHub credential instead of assuming it ([a86af17](https://github.com/Alex1990/tiny-oss/commit/a86af17))
- **loop:** Widen the credential probe to the dangerous scopes too ([f95274e](https://github.com/Alex1990/tiny-oss/commit/f95274e))
- **loop:** Keep a writable credential out of the agent's hands ([c17bfc1](https://github.com/Alex1990/tiny-oss/commit/c17bfc1))
- **loop:** Cross-check the credential probes against GitHub's own permissions ([18b49da](https://github.com/Alex1990/tiny-oss/commit/18b49da))
- **loop:** Replace the unsound permission probe with idempotent writes ([2af56f7](https://github.com/Alex1990/tiny-oss/commit/2af56f7))
- **loop:** Check the agent credential on signals that actually exist ([187d420](https://github.com/Alex1990/tiny-oss/commit/187d420))
- **loop:** Measure Contents with a real write, not the repo permissions object ([a11cc0a](https://github.com/Alex1990/tiny-oss/commit/a11cc0a))
- **loop:** Implement L2c — the host pushes the branch, the agent never can ([fc8072c](https://github.com/Alex1990/tiny-oss/commit/fc8072c))
- **loop:** Give the agent no write credential at all, not a narrower one ([67f799b](https://github.com/Alex1990/tiny-oss/commit/67f799b))
- **loop:** Make the branch ruleset the gate, not the GitHub credential ([13ecf41](https://github.com/Alex1990/tiny-oss/commit/13ecf41))
- **loop:** Tell a job token apart from a PAT in the boundary check ([fe0cd2c](https://github.com/Alex1990/tiny-oss/commit/fe0cd2c))
- **loop:** Let workflow_dispatch fall back to the write switch ([1e452a2](https://github.com/Alex1990/tiny-oss/commit/1e452a2))
- **loop:** Let a triaged task actually reach the implementing stage ([31aa850](https://github.com/Alex1990/tiny-oss/commit/31aa850))
- **loop:** Report every GitHub action a run took, not just the last two ([af4d600](https://github.com/Alex1990/tiny-oss/commit/af4d600))
- **ci:** Run Azure signer oracle in CI ([88982b2](https://github.com/Alex1990/tiny-oss/commit/88982b2))
- **norms:** Let the loop open host PRs, keep merging with the owner ([6a57a66](https://github.com/Alex1990/tiny-oss/commit/6a57a66))
- **loop:** Attribute loop commits to github-actions[bot] ([f7f6897](https://github.com/Alex1990/tiny-oss/commit/f7f6897))
- **norms:** Add Volcano Engine TOS to AGENTS.md entry list ([bb2c01b](https://github.com/Alex1990/tiny-oss/commit/bb2c01b))
- **tooling:** Make the oxlint config effective and clear its warnings ([a3384f7](https://github.com/Alex1990/tiny-oss/commit/a3384f7))
- **tooling:** Cut releases through a pull request, tag after the merge ([a313e70](https://github.com/Alex1990/tiny-oss/commit/a313e70))

### ✅ Tests

- Skip OSS integration cases when no credentials are configured ([8d149b9](https://github.com/Alex1990/tiny-oss/commit/8d149b9))

### 🤖 CI

- Add GitHub Actions workflow for lint and test ([dab2f55](https://github.com/Alex1990/tiny-oss/commit/dab2f55))
- Add coverage and post it as a PR comment ([8020b24](https://github.com/Alex1990/tiny-oss/commit/8020b24))

### ❤️ Contributors

- Alex Chao ([@Alex1990](https://github.com/Alex1990))
- Tiny-oss Loop ([@loop](https://github.com/loop))

## v1.1.0

[compare changes](https://github.com/Alex1990/tiny-oss/compare/v1.0.2...v1.1.0)

### 🚀 Enhancements

- Support server-side upload callback on put and multipartUpload ([9b51826](https://github.com/Alex1990/tiny-oss/commit/9b51826))

### 🩹 Fixes

- No orphan rejection when a multipart part fails for good ([c71d001](https://github.com/Alex1990/tiny-oss/commit/c71d001))

### 📖 Documentation

- Document multipartUpload options and progress semantics ([a2eaacd](https://github.com/Alex1990/tiny-oss/commit/a2eaacd))
- Explain resumable multipart uploads via checkpoint ([f40b3b9](https://github.com/Alex1990/tiny-oss/commit/f40b3b9))

### 🏡 Chore

- Configure bumpp and changelogen for releases ([3c6a5d7](https://github.com/Alex1990/tiny-oss/commit/3c6a5d7))

### ✅ Tests

- Resume OSS multipart upload from a checkpoint ([cc63f60](https://github.com/Alex1990/tiny-oss/commit/cc63f60))

### ❤️ Contributors

- Alex Chao ([@Alex1990](https://github.com/Alex1990))

