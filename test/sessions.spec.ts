import { describe, expect, it } from 'vitest'

import {
  aggregate,
  classifyFailure,
  parseSessionText,
  renderMarkdown,
  repeatedFailures,
} from '../scripts/loop/shared/sessions.mjs'

const line = (value: unknown) => JSON.stringify(value)

const user = {
  type: 'message',
  id: 'u1',
  timestamp: '2026-10-01T00:00:00.000Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'text',
        text:
          'You are one automated run of the tiny-oss loop. Stage: feature.\n\n' +
          '- runId: `r-20261001-000000-aaaa`\n- task: #7 (issue) — demo',
      },
    ],
  },
}

const assistant = (
  id: string,
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>,
  usage: number,
  stopReason = 'toolUse',
  errorMessage?: string,
) => ({
  type: 'message',
  id: `a-${id}`,
  timestamp: '2026-10-01T00:00:01.000Z',
  message: {
    role: 'assistant',
    model: 'test-model',
    usage: { totalTokens: usage, cost: { total: 0.01 } },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    content: toolCalls.map((c) => ({ type: 'toolCall', ...c })),
  },
})

const toolResult = (callId: string, toolName: string, text: string, isError = true) => ({
  type: 'message',
  id: `t-${callId}`,
  timestamp: '2026-10-01T00:00:02.000Z',
  message: {
    role: 'toolResult',
    toolCallId: callId,
    toolName,
    isError,
    content: [{ type: 'text', text }],
  },
})

const sessionText = [
  line({ type: 'session', version: 3, id: 's1', timestamp: '2026-10-01T00:00:00.000Z' }),
  line(user),
  line(
    assistant(
      'a1',
      [{ id: 'c1', name: 'read', arguments: { path: 'skills/feature/SKILL.md' } }],
      100,
    ),
  ),
  line(
    toolResult(
      'c1',
      'read',
      "ENOENT: no such file or directory, access '/repo/skills/feature/SKILL.md'",
    ),
  ),
  line(assistant('a2', [{ id: 'c2', name: 'bash', arguments: { command: 'pnpm test' } }], 200)),
  line(toolResult('c2', 'bash', 'FAIL src/a.spec.ts\n\nCommand exited with code 1')),
  line(assistant('a3', [{ id: 'c3', name: 'bash', arguments: { command: 'pnpm test' } }], 300)),
  line(toolResult('c3', 'bash', 'FAIL src/a.spec.ts\n\nCommand exited with code 1')),
  line(assistant('a4', [], 0, 'error', 'Stream ended without finish_reason')),
  'not json — a torn line must not discard the session',
].join('\n')

describe('session miner', () => {
  const parsed = parseSessionText(sessionText, 'artifact/s1.jsonl')

  it('extracts stage, run, task and the token split from the prompt and usage', () => {
    expect(parsed.stage).toBe('feature')
    expect(parsed.runId).toBe('r-20261001-000000-aaaa')
    expect(parsed.taskId).toBe(7)
    expect(parsed.turns).toBe(4)
    expect(parsed.toolCalls).toBe(3)
    // every assistant call is processed tokens; the last one is the final context size
    expect(parsed.billedTokens).toBe(600)
    expect(parsed.contextTokens).toBe(300)
    expect(parsed.costUsd).toBeCloseTo(0.04)
  })

  it('classifies tool failures and records engine faults', () => {
    expect(parsed.failures.map((f: { category: string }) => f.category)).toEqual([
      'missing-skill',
      'command-failed',
      'command-failed',
    ])
    expect(parsed.engineFaults).toEqual([
      expect.objectContaining({
        stopReason: 'error',
        message: 'Stream ended without finish_reason',
      }),
    ])
  })

  it('classifies the specific CLI/tool failure modes the loop actually hits', () => {
    expect(classifyFailure('bash', 'Unknown JSON field: "authorAssociation"')).toBe('gh-field')
    expect(classifyFailure('bash', 'specify only one of --comments or --json')).toBe('gh-flag')
    expect(classifyFailure('bash', 'fatal: not a git repository')).toBe('git')
    expect(classifyFailure('edit', 'Could not find edits[2] in state/ANOMALIES.md')).toBe(
      'edit-mismatch',
    )
    expect(
      classifyFailure(
        'read',
        "ENOENT: no such file or directory, access '/repo/skills/x/SKILL.md'",
      ),
    ).toBe('missing-skill')
    expect(classifyFailure('read', 'src/index.ts ...')).toBe(null)
  })

  it('surfaces a retry loop once and attributes missing skills by path', () => {
    expect(repeatedFailures(parsed)).toEqual([
      expect.objectContaining({ tool: 'bash', command: 'pnpm test', count: 2 }),
    ])

    const agg = aggregate([parsed], {
      runRows: [
        { runId: parsed.runId, event: 'end', outcome: 'pr-opened', tokens: 300, durationMs: 2000 },
      ],
      generatedAt: '2026-10-01T00:00:03.000Z',
    })
    expect(agg.corpus.sessions).toBe(1)
    expect(agg.corpus.billedTokens).toBe(600)
    expect(agg.corpus.recordedTokens).toBe(300)
    expect(agg.stages[0]).toMatchObject({
      stage: 'feature',
      sessions: 1,
      toolCalls: 3,
      toolErrors: 3,
    })
    expect(agg.retryLoops).toHaveLength(1)
    expect(agg.missingSkills).toEqual([
      expect.objectContaining({
        path: '/repo/skills/feature/SKILL.md',
        count: 1,
        stages: ['feature'],
      }),
    ])

    const md = renderMarkdown(agg)
    expect(md).toContain('| feature | 1 | 600 |')
    expect(md).toContain('missing-skill')
    expect(md).toContain('2.0×')
    expect(md).toContain('Stream ended without finish_reason')
  })
})
