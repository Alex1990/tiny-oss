import { execSync } from 'node:child_process'
import { defineConfig } from 'bumpp'

/**
 * Release flow (driven by `pnpm release`):
 *   1. bumpp bumps the version in package.json (interactive semver prompt)
 *   2. this `execute` hook regenerates CHANGELOG.md for the new version and
 *      stages it, so the changelog lands in the release commit
 *   3. bumpp commits (`chore(release): <version>`) on a `release/v<version>`
 *      branch, pushes that branch and opens a pull request
 *
 * The release commit travels as a pull request because the `Main branch`
 * ruleset refuses every direct push to `main`, releases included: `422 Changes
 * must be made through a pull request`. The owner's bypass (`pull_request`
 * mode) covers merging a PR, not pushing one, so there is nothing to route
 * around — see `docs/norms/release.md`.
 *
 * `pr.base` is pinned instead of detected: bumpp otherwise reads the base from
 * `origin/HEAD`, which still says `master` in clones that predate the rename.
 *
 * bumpp creates no tag in this mode — it cannot know the merge commit, and a
 * squash or rebase merge rewrites the release commit. The tag is made after the
 * merge by `pnpm release:tag` (`scripts/release-tag.mjs`).
 *
 * The commit message and `--all` are passed on the command line in
 * `package.json` rather than set here: bumpp's CLI defaults (`--commit`,
 * `--all`) take precedence over the config file's object form, so a
 * `commit: { message }` here would be silently replaced by the default
 * `chore: release v<version>` — which is how v1.1.0 was committed.
 *
 * `all: true` matters: without it bumpp commits with `git commit <files>`
 * (only the bumped files), which ignores other staged paths — a staged
 * CHANGELOG.md would never land in the release commit.
 *
 * `changelogen -r` must receive the exact new version: without it the heading
 * would read `<oldTag>...<branch>` instead of `v<newVersion>`.
 */
export default defineConfig({
  all: true,
  pr: {
    base: 'main',
    branch: 'release/v{version}',
    title: 'chore(release): {version}',
    body: '{oldVersion} → {version}',
  },
  execute(operation) {
    execSync(`changelogen --output CHANGELOG.md -r ${operation.state.newVersion}`, {
      stdio: 'inherit',
    })
    // A brand-new CHANGELOG.md is untracked, and `git commit -a` skips untracked
    // files, so stage it explicitly.
    execSync('git add CHANGELOG.md', { stdio: 'inherit' })
  },
})
