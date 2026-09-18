# Releasing

How to cut a release of tiny-oss. Tooling: `bumpp` drives the version bump,
the release branch and the pull request; `changelogen` maintains
`CHANGELOG.md`; `scripts/release-tag.mjs` (`pnpm release:tag`) tags the merged
release commit. Orchestration lives in `package.json` scripts and
`bump.config.ts` — read `bump.config.ts` before changing anything here.

A release is a change to `main` like any other, and `main` only moves through a
pull request: the `Main branch` ruleset refuses a direct push with `422 Changes
must be made through a pull request`, for every credential, the owner's
included. So the release commit travels as a PR too. What the owner's bypass
(`bypass_mode: pull_request`) buys is _merging_ a PR without a second
reviewer — which is what makes a solo release possible — not pushing one.

## Loop preflight (recommended)

The loop runs stage=release before you cut a release: all gates green, a
version suggestion (feature → minor, fix/docs → patch, breaking → human),
and a preview changelog. Read its report comment, then follow the Flow below
yourself — `pnpm release`, `pnpm release:tag` and `pnpm publish` stay
human-only.

## Flow

1. **Start from a clean tree on an up-to-date `main`.** `bumpp --pr` refuses
   otherwise (clean tree, on the base branch, not behind `origin/main`).
   `bump.config.ts` sets `all: true`, so the release commit runs `git commit -a`
   and sweeps up every tracked modification and staged file.
2. **Gates** (fast, no browser needed): `pnpm lint && pnpm check:types`.
3. `pnpm release` — interactive semver prompt. Pick per the commits since the
   last tag: new feature(s) → `minor`; fixes/docs/tests only → `patch`. This
   repo has had no breaking change yet, so no `major`. Non-interactive
   (agent/CI): `pnpm exec bumpp --release <patch|minor> --yes`.
   bumpp then creates `release/v<version>`, commits
   `chore(release): <version>` including the regenerated `CHANGELOG.md`, pushes
   the branch, switches you back to `main` and opens the pull request with `gh`.
   **No tag is created** — see step 5.
4. **Merge the release PR.** You authored it, so you cannot approve it; the
   ruleset bypass is what lets you merge it anyway. Merging is the consent.
   Squash and rebase both rewrite the release commit's SHA on `main` — which is
   exactly why the tag is not made on the branch.
5. **`pnpm release:tag`** — on the updated `main`, tags `v<version>` at the
   merge result and pushes the tag. It refuses a dirty tree, a branch other
   than `main`, a `main` out of sync with `origin/main`, and an existing tag.
   `--no-push` creates the tag locally only, for a rehearsal.
6. **`pnpm build && pnpm publish`** — manual, needs npm auth. `dist/` is
   gitignored but ships in the package (`files: ["dist", "UPGRADING.md"]`), so
   build locally right before publishing.

Preview the next changelog without touching anything: `pnpm changelogen`
(stdout only).

## Gotchas (verified against the installed tool versions)

- **Do not plan around a direct push to `main`.** The ruleset answers `422`
  whatever the credential; a PR is the only way in. Tags are _not_ covered —
  there is no tag ruleset — so `git push origin v<version>` works.
- `pr.base: 'main'` MUST stay in `bump.config.ts`. Without it bumpp derives the
  base from `origin/HEAD`, which still says `master` in a clone made before the
  rename, and the precondition check then refuses to run on `main`.
- The commit message lives on the command line in `package.json`, not in
  `bump.config.ts`: bumpp's CLI defaults (`--commit`, `--all`) win over the
  config file's object form, so a `commit: { message }` there is silently
  replaced by the default `chore: release v<version>` — that is how v1.1.0 was
  committed, config and all. `-a` is passed for the same reason: `all: true` in
  the config is the belt, the flag is the braces.
- `bump.config.ts` MUST keep `all: true`. Without it bumpp commits with
  `git commit <files>` (only the bumped files), silently dropping the staged
  `CHANGELOG.md` from the release commit. That shipped once; it was fixed by
  amending the release commit and force-pushing.
- The tag is created after the merge, never on the release branch: bumpp's PR
  mode creates no tag by design, since it cannot know the merge commit. Tags
  are annotated (`git tag -a`) — v1.1.0 was cut by hand and is the one
  lightweight tag in the history.
- `changelogen` needs `-r <newVersion>` (injected by the config's `execute` hook
  from `operation.state.newVersion`), or the changelog heading reads
  `<oldTag>...<branch>` instead of `v<newVersion>`.
- A brand-new `CHANGELOG.md` is untracked, and `git commit -a` skips untracked
  files — the `execute` hook stages it explicitly. Do not pre-create
  `CHANGELOG.md`; the release commit creates it.
- Bare `changelogen` prints to stdout and writes nothing; only `--output` /
  `--bump` / `--release` touch disk.
- Re-tagging after a mistaken push: `git push --force-with-lease origin <tag>`
  fails with `stale info` for tags — use `git push --force origin <tag>`.
- Tags are `v<version>` since v1.0.0 (pre-1.0.0 `0.x.y` tags have no prefix);
  `bumpp`'s default and `scripts/release-tag.mjs` agree on the `v` prefix.
