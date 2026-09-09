#!/usr/bin/env node
/**
 * Post (or update) a coverage summary comment on a pull request.
 *
 * Usage: node .github/scripts/coverage-comment.mjs <pr-number> [--print]
 *
 * Reads coverage/coverage-summary.json (json-summary reporter output),
 * renders a small markdown table and upserts a comment marked with
 * `<!-- coverage-summary -->` so re-runs update instead of stacking.
 * `--print` only prints the body (local verification without GitHub writes).
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const printOnly = args.includes('--print')
const pr = args.find((a) => /^\d+$/.test(a))
if (!pr) {
  console.error('usage: coverage-comment.mjs <pr-number> [--print]')
  process.exit(1)
}

const summaryPath = 'coverage/coverage-summary.json'
if (!existsSync(summaryPath)) {
  console.error(`missing ${summaryPath} - run vitest with --coverage first`)
  process.exit(1)
}

const total = JSON.parse(readFileSync(summaryPath, 'utf8')).total
const row = (metric) => {
  const m = total[metric]
  return `| ${metric[0].toUpperCase() + metric.slice(1)} | ${m.pct.toFixed(2)}% | ${m.covered}/${m.total} |`
}

const body = [
  '<!-- coverage-summary -->',
  '## Coverage',
  '',
  '| Metric | % | Covered / Total |',
  '| --- | ---: | ---: |',
  row('lines'),
  row('statements'),
  row('functions'),
  row('branches'),
  '',
].join('\n')

if (printOnly) {
  process.stdout.write(body)
  process.exit(0)
}

const run = (cmd, ghArgs, options = {}) => {
  const res = spawnSync(cmd, ghArgs, { encoding: 'utf8', ...options })
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout)
    process.exit(1)
  }
  return res.stdout.trim()
}

const repoSlug =
  process.env.GITHUB_REPOSITORY ||
  run('git', ['remote', 'get-url', 'origin'])
    .replace(/^.*github\.com[/:]/, '')
    .replace(/\.git$/, '')

const marker = '<!-- coverage-summary -->'
const comments = JSON.parse(run('gh', ['api', `repos/${repoSlug}/issues/${pr}/comments?per_page=100`]))
const existing = comments.find((c) => c.body && c.body.includes(marker))
const endpoint = existing
  ? `repos/${repoSlug}/issues/comments/${existing.id}`
  : `repos/${repoSlug}/issues/${pr}/comments`
run('gh', ['api', endpoint, '-X', existing ? 'PATCH' : 'POST', '--input', '-'], {
  input: JSON.stringify({ body }),
})
console.log(existing ? `updated comment ${existing.id}` : `posted coverage comment on #${pr}`)
