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
    expect(classifyFailure('bash', 'Unknown JSON field: "authorAssociation"', true)).toBe(
      'gh-field',
    )
    expect(classifyFailure('bash', 'specify only one of --comments or --json', true)).toBe(
      'gh-flag',
    )
    expect(classifyFailure('bash', 'fatal: not a git repository', true)).toBe('git')
    expect(classifyFailure('edit', 'Could not find edits[2] in state/ANOMALIES.md', true)).toBe(
      'edit-mismatch',
    )
    expect(
      classifyFailure(
        'read',
        "ENOENT: no such file or directory, access '/repo/skills/x/SKILL.md'",
        true,
      ),
    ).toBe('missing-skill')
    expect(classifyFailure('read', 'src/index.ts ...', false)).toBe(null)
  })

  it('never classifies a successful tool result, however much failure text it quotes', () => {
    // #82 review: these are exactly the strings a *read* of a log/test/fixture prints,
    // and the heuristic used to count them as failures (phantom missing-skill rows).
    const quoted = "ENOENT: no such file or directory, access '/repo/skills/feature/SKILL.md'"
    expect(classifyFailure('read', quoted, false)).toBe(null)
    expect(classifyFailure('bash', 'fatal: not a git repository', false)).toBe(null)
    expect(classifyFailure('bash', 'Command exited with code 1', false)).toBe(null)

    const text = [
      line({ type: 'session', version: 3 }),
      line(user),
      line(
        assistant(
          'q1',
          [{ id: 'cq', name: 'read', arguments: { path: 'test/sessions.spec.ts' } }],
          10,
        ),
      ),
      line(toolResult('cq', 'read', quoted, false)),
    ].join('\n')
    expect(parseSessionText(text).failures).toEqual([])
  })

  it('redacts credentials before a detail reaches the report', () => {
    const text = [
      line({ type: 'session', version: 3 }),
      line(user),
      line(assistant('r1', [{ id: 'cr', name: 'bash', arguments: { command: 'cat .env' } }], 10)),
      line(
        toolResult(
          'cr',
          'bash',
          'GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123\n' +
            'DEEPSEEK_API_KEY=sk-abcdefghijklmnopqrstuvwx\n\nCommand exited with code 1',
        ),
      ),
    ].join('\n')
    const failure = parseSessionText(text).failures[0]
    expect(failure.category).toBe('command-failed')
    expect(failure.detail).not.toContain('ghp_')
    expect(failure.detail).not.toContain('sk-abcdefghij')
    expect(failure.detail).toContain('[redacted]')
  })

  it('states how much of the corpus was actually read', () => {
    const agg = aggregate([parsed], {
      artifacts: { attempted: 5, read: 4, skipped: 1 },
      generatedAt: '2026-10-01T00:00:03.000Z',
    })
    const md = renderMarkdown(agg)
    expect(md).toContain('read 4/5 artifacts')
    expect(md).toContain('1 skipped')
    expect(md).toContain('only the artifacts that were read')
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

  it('joins one run row once, however many sessions share its runId', () => {
    // `pr-review` runs two reviewers in one run and stores one end row summing both
    // (#82 review): joining per session doubled `recorded` and counted the outcome twice.
    const a = parseSessionText(sessionText, 'artifact/reviewer-a.jsonl')
    const b = { ...a, name: 'artifact/reviewer-b.jsonl' }
    const agg = aggregate([a, b], {
      runRows: [{ runId: a.runId, event: 'end', outcome: 'rejected', tokens: 300 }],
      generatedAt: '2026-10-01T00:00:03.000Z',
    })
    expect(agg.corpus.recordedTokens).toBe(300)
    expect(agg.corpus.joinedSessions).toBe(1)
    expect(agg.stages[0]).toMatchObject({
      sessions: 2,
      recordedTokens: 300,
      outcomes: { rejected: 1 },
    })
  })

  it('says when files were parsed but kept as no loop session, and when no run row joined', () => {
    const agg = aggregate([parsed], {
      inputFiles: 3,
      generatedAt: '2026-10-01T00:00:03.000Z',
    })
    const md = renderMarkdown(agg)
    expect(md).toContain('3 file(s) parsed → 1 loop session(s)')
    expect(md).toContain('2 not a loop session')
    expect(md).toContain('Recorded-token comparison unavailable')
  })
})
