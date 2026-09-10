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
import { createHash } from 'node:crypto';
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
 * 每仓一桶，桶名 `loop-state-<owner>-<repo>`。
 *
 * 为什么不用一个桶装所有仓库：R2 的 API token 权限只能限到**桶**，限不到前缀
 * （Access Policy 的资源标识是 `...r2.bucket.<ACCOUNT_ID>_<JURISDICTION>_<BUCKET>`，
 * 没有 key/prefix 维度）。共用桶时「每仓一把独立 token」形同虚设 —— 每把都能读写
 * 整个桶，一次凭据泄漏或 fork 注入的影响面就是所有接入仓库。
 *
 * 为什么带 owner：桶名是账号内全局唯一的平铺空间，桶名撞车就真的撞车。带上 owner
 * 把冲突面从「仓库名」提到「owner + 仓库名」，将来管理多个 GitHub 组织也不会互撞。
 * `R2_BUCKET` 可覆盖（迁移、排查、临时指向别的桶）。
 */
let ownerRepoCache = null;

/** 解析 owner/repo：CI 取 GITHUB_REPOSITORY，本地取 package.json 的 repository.url。 */
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
    throw new Error(`无法确定仓库身份：GITHUB_REPOSITORY 未设，且读不到 ${path.join(ROOT, 'package.json')}（${e.message}）。请显式设置 R2_BUCKET。`);
  }
  // npm 允许 repository 是字符串（`"owner/repo"`、`"github:owner/repo"`）或对象（`{ url }`）
  const raw = typeof pkg.repository === 'string' ? pkg.repository : (pkg.repository?.url ?? '');
  const url = String(raw).replace(/^git\+/, '').replace(/\.git$/, '');
  const m = /github\.com[/:]([^/]+)\/(.+)$/.exec(url)
    ?? /^(?:github:)?([\w.-]+)\/([\w.-]+)$/.exec(url);
  if (!m) {
    throw new Error(`无法从 package.json 推导 owner/repo（repository = ${raw || '缺失'}）。请显式设置 R2_BUCKET。`);
  }
  return (ownerRepoCache = { owner: m[1], repo: m[2] });
}

/** R2 桶名只允许小写字母/数字/连字符，且不以连字符开头或结尾（官方约束）。 */
const sanitize = (seg) => String(seg).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const BUCKET_MAX = 63;

function derivedBucketName() {
  const { owner, repo } = ownerRepo();
  const base = `loop-state-${sanitize(owner)}-${sanitize(repo)}`;
  if (base.length <= BUCKET_MAX) return base;
  // GitHub 仓库名上限 100 字符，`owner-repo` 拼接后理论上会超过 63。
  // 截断 + 稳定哈希:同一仓库每次推导同一桶名,不同仓库也不会因截断而碰撞。
  const h = createHash('sha256').update(base).digest('hex').slice(0, 8);
  return `${base.slice(0, BUCKET_MAX - h.length - 1).replace(/-+$/, '')}-${h}`;
}

/** 本仓的 R2 桶名。 */
export const bucket = () => process.env.R2_BUCKET || derivedBucketName();

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
    // AWS CLI v2 会把结果交给 pager（`less`）。脚本化调用下这表现为"命令挂起"——
    // 光标停住、毫无输出、其实是在等按键。程序化调用永远不要 pager。
    AWS_PAGER: '',
    // 跨境访问 R2 的握手约 0.4s，但慢链路下会退化。给出明确的边界，
    // 让失败快速暴露成错误，而不是长时间静默重试。
    AWS_MAX_ATTEMPTS: process.env.AWS_MAX_ATTEMPTS ?? '3',
  };
}

/** 全局 CLI 边界：连接/读取超时，避免"看起来挂起"。 */
const CLI_LIMITS = ['--cli-connect-timeout', '15', '--cli-read-timeout', '60'];

const endpoint = () => `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const s3url = (prefix) => `s3://${bucket()}/${prefix}`;

/**
 * 调用 aws CLI。
 *
 * `stream: true` 让子进程直接写终端 —— sync 类操作在跨境链路上可能需要数秒到
 * 数十秒，spawnSync 的缓冲会让这段时间毫无输出（"看起来挂起"）。只有在需要
 * 解析输出的场合（check 数行数）才捕获。
 */
function aws(args, { label, stream = false }) {
  const r = spawnSync('aws', [...args, ...CLI_LIMITS], {
    env: r2Env(),
    encoding: stream ? undefined : 'utf8',
    stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
  });
  if (r.error) throw new Error(`[r2:${label}] 无法执行 aws cli：${r.error.message}`);
  if (stream) {
    if (r.status !== 0) throw new Error(`[r2:${label}] aws cli 退出码 ${r.status}`);
    return '';
  }
  const out = (r.stdout ?? '').trim();
  const err = (r.stderr ?? '').trim();
  if (r.status !== 0) throw new Error(`[r2:${label}] aws cli 退出码 ${r.status}\n${err || out}`);
  if (out) console.log(out);
  if (err) console.error(err);
  return out;
}

/** 远端 → 本地。不做 --delete：runner 上 state/ 全新，陈旧文件问题不存在。 */
export function pull(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', s3url(prefix), dir, '--endpoint-url', endpoint()], { label: 'pull', stream: true });
}

/**
 * 本地 → 远端。**不带 `--delete`**：R2 没有对象版本化（Cloudflare 文档无此能力，
 * 仅有 bucket lock 保留策略），删除不可回滚 —— 因此只做"覆盖 + 新增"。
 * 代价是 run 期间删掉的过期锁文件会残留在远端，由 TTL 语义消化（lockExpired）。
 */
export function push(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'push', stream: true });
}

/**
 * 首次播种：本地 → 远端，**不带 --delete**（只增不删）——
 * 远端已有对象时宁可保守，不冒清空风险。
 */
export function seed(dir, { prefix = R2_PREFIX } = {}) {
  return aws(['s3', 'sync', dir, s3url(prefix), '--endpoint-url', endpoint()], { label: 'seed', stream: true });
}

/** 连通性与凭据自检：列出前缀下对象数（空桶同样算通过）。 */
export function check({ prefix = R2_PREFIX } = {}) {
  const out = aws(['s3', 'ls', s3url(prefix), '--endpoint-url', endpoint(), '--recursive'], { label: 'check' });
  const n = out ? out.split('\n').filter(Boolean).length : 0;
  console.log(`[loop:r2] 连通 OK，前缀 ${prefix} 现有 ${n} 个对象`);
  return n;
}
