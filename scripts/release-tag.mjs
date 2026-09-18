#!/usr/bin/env node
/**
 * Tag a release after its pull request has been merged on `main`.
 *
 * `pnpm release` (bumpp in `--pr` mode) deliberately creates no tag: it cannot
 * know the merge commit, and a squash or rebase merge rewrites the release
 * commit — a tag made on the release branch would point at a commit that never
 * lands on `main`. The tag is created here instead, on an up-to-date `main`,
 * and names the version the merged release commit shipped.
 *
 * Usage:
 *   pnpm release:tag            create the tag and push it
 *   pnpm release:tag --no-push  create it locally only (rehearse, then
 *                               `git tag -d <tag>`)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const noPush = process.argv.includes('--no-push')

/** Run a git command in the repository, returning its trimmed stdout. */
function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
}

function fail(message) {
  console.error(`release:tag: ${message}`)
  process.exit(1)
}

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const tag = `v${version}`

if (git('status', '--porcelain') !== '') {
  fail('the working tree is not clean — commit or stash first')
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') {
  fail(`on "${branch}", expected "main" — the tag belongs on the merged release commit`)
}

git('fetch', 'origin', 'main')
const head = git('rev-parse', 'HEAD')
if (head !== git('rev-parse', 'origin/main')) {
  fail('local main is not in sync with origin/main — pull first')
}

if (git('tag', '--list', tag) !== '') {
  fail(`tag ${tag} already exists`)
}

git('tag', '-a', tag, '-m', tag)
console.log(`release:tag: tagged ${tag} at ${head.slice(0, 7)}`)

if (noPush) {
  console.log(
    `release:tag: --no-push — the tag is local only (remove it with \`git tag -d ${tag}\`)`,
  )
} else {
  execFileSync('git', ['push', 'origin', tag], { cwd: root, stdio: 'inherit' })
  console.log(`release:tag: pushed ${tag}`)
}

console.log('release:tag: next, `pnpm build && pnpm publish`')
