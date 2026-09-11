/**
 * GitHub event → Loop decision (pure-function router).
 *
 * Authority: 05 host implementation spec §3 routing table / docs/agents/ops.md
 * "Trigger → loop map".
 * This module does no IO: the input is the event context injected by the workflow and
 * the output is a Decision, executed by entry.mjs.
 * Pure function = offline regression on fixed event samples, no need to fire real
 * GitHub events.
 */

/**
 * author_association considered "this repo's own people"
 * (everything else = external contributor).
 */
export const OWNER_ROLES = ['OWNER', 'MEMBER', 'COLLABORATOR'];

/** Cron for the weekly retro (kept in sync with loop.yml's schedule). */
export const WEEKLY_CRON = '23 3 * * 1';

const noop = (reason) => ({ action: 'noop', reason });
const run = (o) => ({ action: 'run', ...o });
const metrics = (o) => ({ action: 'metrics', ...o });
const inbox = (o) => ({ action: 'inbox', ...o });
/**
 * Move a task to a terminal state without recording metrics — for closures that
 * must not count toward the acceptance rate because the PR was not loop-produced.
 */
const terminal = (o) => ({ action: 'terminal', ...o });

/**
 * Loop PR test: head branch `loop/<n>-*` and body containing `loop-task: #<n>`
 * (both must agree).
 */
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
 * Idempotency key: skip an event whose key has already been consumed.
 * Prefer immutable identifiers (PR head sha / comment id), falling back to the
 * issue's updated_at revision.
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
      // Info supplement: never silently drop; land in inbox first, then decide from the
      // task state whether a catch-up run is needed (05 §3 decision order)
      if (action === 'edited') {
        return inbox({ taskId: n, kind: 'issue', stage: 'triage', reason: 'issues.edited' });
      }
      return noop(`issues.${action} has no Loop action`);
    }

    case 'issue_comment': {
      if (action !== 'created') return noop(`issue_comment.${action} has no Loop action`);
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
        return noop(`pull_request.${action} routed elsewhere`);
      }
      const loopTask = loopTaskOf(pr);
      if (loopTask) {
        return run({ taskId: pr.number, kind: 'pr', stage: 'pr-review', loopTask, reason: `loop PR ${action}` });
      }
      if (isDependabotPr(pr)) {
        return run({ taskId: pr.number, kind: 'pr', stage: 'deps', reason: 'dependabot PR' });
      }
      if (isExternalPr(pr)) {
        return run({
          taskId: pr.number, kind: 'pr', stage: 'triage', mode: 'readonly',
          reason: 'external PR analysed read-only',
        });
      }
      // PRs and issues share the triage surface (issue-tracker.md: PRs ARE a triage surface)
      return run({ taskId: pr.number, kind: 'pr', stage: 'triage', reason: `repo PR ${action}` });
    }

    case 'pull_request_review': {
      const pr = event.pull_request ?? {};
      if (action !== 'submitted' && action !== 'dismissed') {
        return noop(`pull_request_review.${action} has no Loop action`);
      }
      const loopTask = loopTaskOf(pr);
      if (!loopTask) return noop('review of a non-loop PR does not trigger a run');
      return run({ taskId: pr.number, kind: 'pr', stage: 'pr-review', loopTask, reason: `review ${action}` });
    }

    case 'pull_request_target': {
      const pr = event.pull_request ?? {};
      if (action !== 'closed') return noop(`pull_request_target.${action} has no Loop action`);
      const merged = Boolean(pr.merged);
      const loopTask = loopTaskOf(pr);
      if (loopTask) {
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
      // Not loop-produced, so it must not enter the acceptance metric — but its own
      // task still has to reach a terminal state, or it sits in the inbox forever
      // (ops.md maps "(none, merged) -> accepted", "(none, closed unmerged) ->
      // rejected"). Every owner PR gets a task from `pull_request` triage, so
      // without this each merge strands a zombie in the state layer, and sweep
      // cannot repair it: sweep lists *open* GitHub items, which cannot see a
      // closure. (Dependabot PRs are skipped before triage by the credential
      // guard, D28, so for them this branch is a no-op.)
      return terminal({
        reason: `non-loop PR ${merged ? 'merged' : 'closed-unmerged'} `
          + '(not counted for auto-acceptance)',
        taskId: pr.number,
        to: merged ? 'accepted' : 'rejected',
        pr: pr.number,
      });
    }

    case 'release': {
      if (action !== 'published') return noop(`release.${action} has no Loop action`);
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
      return noop('workflow_dispatch provided no task/stage');
    }

    default:
      return noop(`unhandled event ${eventName}`);
  }
}
