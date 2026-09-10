/**
 * R2 state layer sync (pull / push / seed).
 *
 * Tool choice: the runner image (ubuntu-24.04) preinstalls AWS CLI v2 (2.36.x),
 * so we talk to R2's S3-compatible endpoint directly with zero install and zero
 * new repo dependencies (no @aws-sdk/client-s3).
 *
 * Key settings:
 *   - pass `auto` as the region: R2 requires a non-empty value but does not use
 *     it (official AWS CLI docs).
 *   - `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`: AWS CLI >= 2.23.0 computes
 *     a CRC32 checksum for uploads by default, which is unfriendly to some
 *     S3-compatible services; on-demand calculation is the most conservative
 *     compatibility choice.
 *   - `AWS_EC2_METADATA_DISABLED=true`: avoid instance-metadata probing slowing
 *     things down / erroring out in non-EC2 environments.
 *
 * Failure semantics (important): a failed pull MUST abort the whole chain —
 * otherwise the local state/ is empty, and what push then uploads is not a
 * complete state layer.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * Path prefix inside the bucket. **One bucket per repo** (the owner's decision);
 * the bucket name already carries the repo identity, so the prefix no longer
 * repeats the repo segment — remote keys map 1:1 to the local `state/`.
 */
export const R2_PREFIX = 'state/';

/**
 * One bucket per repo, named `loop-state-<owner>-<repo>`.
 *
 * Why not one bucket for all repos: R2 API token permissions can only be scoped
 * to a **bucket**, never to a prefix (an Access Policy resource is
 * `...r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET>`, with no key/prefix
 * dimension). With a shared bucket, "an independent token per repo" is
 * meaningless — every token can read and write the whole bucket, so a single
 * credential leak or fork injection would affect every onboarded repo.
 *
 * Why include the owner: bucket names are a flat namespace unique per account,
 * so a name collision is a real collision. Including the owner raises the
 * collision surface from "repo name" to "owner + repo name", so managing
 * multiple GitHub organizations in the future will not collide either.
 * `R2_BUCKET` can override this (migration, troubleshooting, temporarily
 * pointing at another bucket).
 */
let ownerRepoCache = null;

/** Resolve owner/repo: GITHUB_REPOSITORY in CI, repository.url from package.json locally. */
function ownerRepo() {
  if (ownerRepoCache) return ownerRepoCache;

  const fromCi = (process.env.GITHUB_REPOSITORY ?? '').trim();
  if (fromCi.includes('/')) {
    const [owner, repo] = fromCi.split('/');
    return (ownerRepoCache = { owner, repo });
  }

  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  } catch (e) {
    throw new Error(`Cannot determine repo identity: GITHUB_REPOSITORY is unset and ${path.join(ROOT, 'package.json')} cannot be read (${e.message}). Please set R2_BUCKET explicitly.`);
  }
  // npm allows repository to be a string (`"owner/repo"`, `"github:owner/repo"`)
  // or an object (`{ url }`)
  const raw = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  const url = String(raw).replace(/^git\+/, '').replace(/\.git$/, '');
  const m = /github\.com[/:]([^/]+)\/(.+)$/.exec(url)
    ?? /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url);
  if (!m) {
    throw new Error(`Cannot derive owner/repo from package.json (repository = ${raw || 'missing'}). Please set R2_BUCKET explicitly.`);
  }
  return (ownerRepoCache = { owner: m[1], repo: m[2] });
}

/** R2 bucket names allow only lowercase letters/digits/hyphens, and never
 * start or end with a hyphen (official constraint). */
const sanitize = (seg) => String(seg).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const BUCKET_MAX = 63;

function derivedBucketName() {
  const { owner, repo } = ownerRepo();
  const base = `loop-state-${sanitize(owner)}-${sanitize(repo)}`;
  if (base.length <= BUCKET_MAX) return base;
  // GitHub repo names are capped at 100 characters, so the joined `owner-repo`
  // can in theory exceed 63. Truncate + stable hash: the same repo derives the
  // same bucket name every time, and different repos will not collide by truncation.
  const h = createHash('sha256').update(base).digest('hex').slice(0, 8);
  return `${base.slice(0, BUCKET_MAX - h.length - 1).replace(/-+$/, '')}-${h}`;
}

/** This repo's R2 bucket name. */
export const bucket = () => process.env.R2_BUCKET || derivedBucketName();

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

export function r2Env() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing R2 environment variables: ${missing.join(', ')} (configure as Actions secret/variable, never write into repo files)`);
  }
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: 'auto',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_EC2_METADATA_DISABLED: 'true',
    // AWS CLI v2 hands results to a pager (`less`). Under scripted invocation this
    // looks like a "hung command" — the cursor stops, there is no output, yet it
    // is actually waiting for a keypress. Never use a pager for programmatic calls.
    AWS_PAGER: '',
    // A cross-border handshake to R2 takes about 0.4s but degrades on slow links.
    // Set explicit bounds so failures surface quickly as errors instead of long
    // silent retries.
    AWS_MAX_ATTEMPTS: process.env.AWS_MAX_ATTEMPTS ?? '3',
  };
}

/** Global CLI bounds: connect/read timeouts, to avoid "looking hung". */
const CLI_LIMITS = ['--cli-connect-timeout', '15', '--cli-read-timeout', '60'];

const endpoint = () => `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3url = (prefix) => `s3://${bucket()}/${prefix}`;

/**
 * Invoke the aws CLI.
 *
 * `stream: true` lets the child process write to the terminal directly — sync
 * operations can take seconds to tens of seconds over cross-border links, and
 * spawnSync buffering would leave that window with no output ("looking hung").
 * Only capture output when it must be parsed (check counting lines).
 */
function aws(args, { label, stream = false }) {
  const r = spawnSync('aws', [...args, ...CLI_LIMITS], {
    env: r2Env(),
    encoding: stream ? undefined : 'utf8',
    stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) throw new Error(`[r2:${label}] failed to run aws cli: ${r.error.message}`);
  if (stream) {
    if (r.status !== 0) throw new Error(`[r2:${label}] aws cli exited with code ${r.status}`);
    return '';
  }
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  if (r.status !== 0) throw new Error(`[r2:${label}] aws cli exited with code ${r.status}\n${err || out}`);
  if (out) console.log(out);
  if (err) console.error(err);
  return out;
}

/** Remote → local. No --delete: state/ is fresh on the runner, so no stale files. */
export function pull(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', s3url(prefix), dir, '--endpoint-url', endpoint()], { label: 'pull', stream: true });
}

/**
 * Local → remote. **No `--delete`**: R2 has no object versioning (Cloudflare's
 * docs offer no such capability, only bucket lock retention policies), so
 * deletes are not revertible — hence "overwrite + add" only. The cost is that
 * expired lock files removed during a run linger on the remote, absorbed by the
 * TTL semantics (lockExpired).
 */
export function push(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'push', stream: true });
}

/**
 * First seed: local → remote, **no --delete** (add only, never remove) —
 * when the remote already has objects, prefer being conservative over risking
 * a wipe.
 */
export function seed(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'seed', stream: true });
}

/** Connectivity/credential self-check: count objects under the prefix (empty bucket passes). */
export function check({ prefix = R2_PREFIX } = {}) {
  const out = aws(['s3', 'ls', s3url(prefix), '--endpoint-url', endpoint(), '--recursive'], { label: 'check' });
  const n = out ? out.split('\n').filter(Boolean).length : 0;
  console.log(`[loop:r2] connectivity OK, prefix ${prefix} currently has ${n} objects`);
  return n;
}
