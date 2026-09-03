import { execSync } from 'node:child_process'
import { defineConfig } from 'bumpp'

/**
 * Release flow (driven by `pnpm release`):
 *   1. bumpp bumps the version in package.json (interactive semver prompt)
 *   2. this `execute` hook regenerates CHANGELOG.md for the new version and
 *      stages it, so the changelog lands in the release commit
 *   3. bumpp commits (`chore(release): <version>`, matching repo history),
 *      tags `v<version>` and pushes
 *
 * `changelogen -r` must receive the exact new version: without it the heading
 * would read `<oldTag>...<branch>` instead of `v<newVersion>`.
 *
 * `all: true` matters: without it bumpp commits with `git commit <files>`
 * (only the bumped files), which ignores other staged paths — a staged
 * CHANGELOG.md would never land in the release commit. `git commit -a`
 * commits the whole index.
 */
export default defineConfig({
  all: true,
  commit: {
    message: 'chore(release): {version}',
  },
  execute(operation) {
    execSync(`changelogen --output CHANGELOG.md -r ${operation.state.newVersion}`, {
      stdio: 'inherit',
    })
    // A brand-new CHANGELOG.md is untracked, and `git commit -a` skips
    // untracked files, so stage it explicitly.
    execSync('git add CHANGELOG.md', { stdio: 'inherit' })
  },
})
