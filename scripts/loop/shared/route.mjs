/**
 * GitHub 事件 → Loop 决策（纯函数路由）。
 *
 * 权威：05 宿主实现规格 §3 路由表 / docs/agents/ops.md "Trigger → loop map"。
 * 本模块不做任何 IO：输入是 workflow 注入的事件上下文，输出 Decision，由 entry.mjs 执行。
 * 纯函数 = 可用固定事件样本离线回归，不必触发真实 GitHub 事件。
 */

/** 视为"本仓自己人"的 author_association（其余 = 外部贡献者）。 */
export const OWNER_ROLES = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** 每周 retro 的 cron（与 loop.yml 的 schedule 保持一致）。 */
export const WEEKLY_CRON = '23 3 * * 1';

const noop = (reason) => ({ action: 'noop', reason });
const run = (o) => ({ action: 'run', ...o });
const metrics = (o) => ({ action: 'metrics', ...o });
const inbox = (o) => ({ action: 'inbox', ...o });

/** loop PR 判定：head 分支 `loop/<n>-*` 且 body 含 `loop-task: #<n>`（两处一致才认）。 */
export function loopTaskOf(pr) {
  const m = /^loop\/(\d+)-/.exec(pr?.head?.ref ?? '');
  const b = /loop-task:\s*#(\d+)/.exec(pr?.body ?? '');
  if (!m || !b) return null;
  return Number(m[1]) === Number(b[1]) ? Number(m[1]) : null;
}

export const isDependabotPr = (pr) =>
  (pr?.user?.login ?? '') === 'dependabot[bot]'
  || (pr?.head?.ref ?? '').startsWith('dependabot/');

export const isExternalPr = (pr) => !OWNER_ROLES.includes(pr?.author_association ?? '');

/**
 * 幂等键：同键事件已消费过则跳过。
 * 优先用不可变标识（PR head sha / comment id），退回 issue 的 updated_at 版本号。
 */
export function eventKey({ eventName, action, event = {} }) {
  const node = event.pull_request ?? event.issue ?? {};
  const ver = event.pull_request?.head?.sha
    ?? event.comment?.id
    ?? node.updated_at
    ?? '';
  return `${eventName}:${action}:${node.number ?? ''}:${ver}`;
}

/**
 * @param {{eventName: string, action?: string, event?: object}} ctx
 * @returns {{action: 'noop'|'run'|'metrics'|'inbox', reason: string, taskId?: number,
 *            kind?: 'issue'|'pr', stage?: string, mode?: 'normal'|'readonly',
 *            loopTask?: number, metrics?: object}}
 */
export function route({ eventName, action, event = {} }) {
  switch (eventName) {
    case 'issues': {
      const n = event.issue?.number;
      if (action === 'opened' || action === 'reopened') {
        return run({ taskId: n, kind: 'issue', stage: 'triage', reason: `issues.${action}` });
      }
      // 信息补足：永不静默丢弃，先落 inbox 再按任务状态决定是否补跑（05 §3 判定顺序）
      if (action === 'edited') {
        return inbox({ taskId: n, kind: 'issue', stage: 'triage', reason: 'issues.edited' });
      }
      return noop(`issues.${action} 无 Loop 动作`);
    }

    case 'issue_comment': {
      if (action !== 'created') return noop(`issue_comment.${action} 无 Loop 动作`);
      const issue = event.issue ?? {};
      return inbox({
        taskId: issue.number,
        kind: issue.pull_request ? 'pr' : 'issue',
        reason: 'issue_comment.created',
        commentId: event.comment?.id,
      });
    }

    case 'pull_request': {
      const pr = event.pull_request ?? {};
      if (action !== 'opened' && action !== 'synchronize') {
        return noop(`pull_request.${action} 走其他路由`);
      }
      const loopTask = loopTaskOf(pr);
      if (loopTask) {
        return run({ taskId: pr.number, kind: 'pr', stage: 'pr-review', loopTask, reason: `loop PR ${action}` });
      }
      if (isDependabotPr(pr)) {
        return run({ taskId: pr.number, kind: 'pr', stage: 'deps', reason: 'dependabot PR' });
      }
      if (isExternalPr(pr)) {
        return run({ taskId: pr.number, kind: 'pr', stage: 'triage', mode: 'readonly', reason: '外部 PR 只读分析' });
      }
      // PR 与 issue 共用 triage 面（issue-tracker.md: PRs ARE a triage surface）
      return run({ taskId: pr.number, kind: 'pr', stage: 'triage', reason: `本仓 PR ${action}` });
    }

    case 'pull_request_review': {
      const pr = event.pull_request ?? {};
      if (action !== 'submitted' && action !== 'dismissed') {
        return noop(`pull_request_review.${action} 无 Loop 动作`);
      }
      const loopTask = loopTaskOf(pr);
      if (!loopTask) return noop('非 loop PR 的 review 不触发 run');
      return run({ taskId: pr.number, kind: 'pr', stage: 'pr-review', loopTask, reason: `review ${action}` });
    }

    case 'pull_request_target': {
      const pr = event.pull_request ?? {};
      if (action !== 'closed') return noop(`pull_request_target.${action} 无 Loop 动作`);
      const loopTask = loopTaskOf(pr);
      if (!loopTask) return noop('非 loop PR 的关闭不计入自动接受率');
      const merged = Boolean(pr.merged);
      return metrics({
        reason: `loop PR ${merged ? 'merged' : 'closed-unmerged'}`,
        metrics: {
          event: merged ? 'merged' : 'closed-unmerged',
          taskId: loopTask,
          pr: pr.number,
          accepted: merged,
          writer: 'workflow',
        },
      });
    }

    case 'release': {
      if (action !== 'published') return noop(`release.${action} 无 Loop 动作`);
      return metrics({
        reason: 'release published',
        metrics: { event: 'released', version: event.release?.tag_name ?? null, accepted: true, writer: 'workflow' },
      });
    }

    case 'schedule': {
      const cron = event.schedule ?? '';
      if (cron === WEEKLY_CRON) return run({ stage: 'retro-scheduled', reason: 'weekly schedule' });
      return run({ stage: 'sweep', reason: `schedule ${cron || '(daily)'}` });
    }

    case 'workflow_dispatch': {
      const inputs = event.inputs ?? {};
      if (inputs.task) {
        return run({
          taskId: Number(inputs.task),
          stage: inputs.stage || 'triage',
          reason: 'manual dispatch',
        });
      }
      if (inputs.stage) return run({ stage: inputs.stage, reason: 'manual dispatch (no task)' });
      return noop('workflow_dispatch 未提供 task/stage');
    }

    default:
      return noop(`未监听的事件 ${eventName}`);
  }
}
