/**
 * R2 状态层同步（pull / push / seed）。
 *
 * 工具选择：runner 镜像（ubuntu-24.04）预装 AWS CLI v2（2.36.x）→ 直接走 R2 的
 * S3 兼容端点，零安装、零新增仓库依赖（不引 @aws-sdk/client-s3）。
 *
 * 取值要点：
 *   - region 传 `auto`：R2 要求非空但不使用该值（官方 aws CLI 文档）。
 *   - `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`：AWS CLI ≥ 2.23.0 默认对上传
 *     计算 CRC32 校验和，对部分 S3 兼容服务不友好；按需计算是兼容性最保守的一档。
 *   - `AWS_EC2_METADATA_DISABLED=true`：避免在非 EC2 环境探测实例元数据拖慢/报错。
 *
 * 失败语义（重要）：pull 失败必须中止整条链 —— 否则本地 state/ 为空，
 * 随后 push 出去的就不是完整状态层。
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * 桶内路径前缀。**每仓一桶**（owner 定稿），桶名已承载仓库身份，
 * 前缀不再重复 repo 段 —— 远端 key 与本地 `state/` 一一对应。
 */
export const R2_PREFIX = 'state/';

/**
 * 每仓一桶。
 *
 * 为什么不用一个桶装所有仓库：R2 的 API token 权限只能限到**桶**，限不到前缀
 * （Access Policy 的资源标识是 `...r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET>`，
 * 没有 key/prefix 维度）。共用桶时「每仓一把独立 token」形同虚设 —— 每把都能读写
 * 整个桶，一次凭据泄漏或 fork 注入的影响面就是所有接入仓库。
 *
 * 桶名规则 `loop-state-<repo>`，`R2_BUCKET` 可覆盖（迁移、排查、临时指向别的桶）。
 */
let repoNameCache = null;

function repoName() {
  if (repoNameCache) return repoNameCache;
  // CI：GITHUB_REPOSITORY = "owner/repo"
  const fromCi = (process.env.GITHUB_REPOSITORY ?? '').split('/')[1];
  if (fromCi) return (repoNameCache = fromCi);
  // 本地（seed 等）：package.json 的 name，与仓库名约定一致
  try {
    repoNameCache = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).name;
  } catch (e) {
    throw new Error(`无法确定仓库名（GITHUB_REPOSITORY 未设，且读不到 ${path.join(ROOT, 'package.json')}）：${e.message}`);
  }
  return repoNameCache;
}

/** 本仓的 R2 桶名。 */
export const bucket = () => process.env.R2_BUCKET || `loop-state-${repoName()}`;

const REQUIRED = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

export function r2Env() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`缺少 R2 环境变量: ${missing.join(', ')}（应配为 Actions secret/variable，勿写进仓库文件）`);
  }
  return {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    AWS_DEFAULT_REGION: 'auto',
    AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required',
    AWS_EC2_METADATA_DISABLED: 'true',
  };
}

const endpoint = () => `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3url = (prefix) => `s3://${bucket()}/${prefix}`;

function aws(args, { label }) {
  const r = spawnSync('aws', args, { env: r2Env(), encoding: 'utf8' });
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  if (r.error) throw new Error(`[r2:${label}] 无法执行 aws cli：${r.error.message}`);
  if (r.status !== 0) throw new Error(`[r2:${label}] aws cli 退出码 ${r.status}\n${err || out}`);
  if (out) console.log(out);
  if (err) console.error(err);
  return out;
}

/** 远端 → 本地。不做 --delete：runner 上 state/ 全新，陈旧文件问题不存在。 */
export function pull(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', s3url(prefix), dir, '--endpoint-url', endpoint()], { label: 'pull' });
}

/**
 * 本地 → 远端。**不带 `--delete`**：R2 没有对象版本化（Cloudflare 文档无此能力，
 * 仅有 bucket lock 保留策略），删除不可回滚 —— 因此只做"覆盖 + 新增"。
 * 代价是 run 期间删掉的过期锁文件会残留在远端，由 TTL 语义消化（lockExpired）。
 */
export function push(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'push' });
}

/**
 * 首次播种：本地 → 远端，**不带 --delete**（只增不删）——
 * 远端已有对象时宁可保守，不冒清空风险。
 */
export function seed(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'seed' });
}

/** 连通性与凭据自检：列出前缀下对象数（空桶同样算通过）。 */
export function check({ prefix = R2_PREFIX } = {}) {
  const out = aws(['s3', 'ls', s3url(prefix), '--endpoint-url', endpoint(), '--recursive'], { label: 'check' });
  const n = out ? out.split('\n').filter(Boolean).length : 0;
  console.log(`[loop:r2] 连通 OK，前缀 ${prefix} 现有 ${n} 个对象`);
  return n;
}
