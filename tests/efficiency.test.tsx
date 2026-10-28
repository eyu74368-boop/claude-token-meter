import { expect, test } from 'claude-code/testing'

import { DEFAULTS } from '../hooks/core/config'
import { PANE_EFF, PLUGIN } from '../hooks/core/ids'
import { effLevel, effVerdict, limitInfo, pruneOrder, turnEff, wasteTurns } from '../hooks/panes/efficiency'
import type { Snap } from '../hooks/panes/efficiency'
import { parseTranscript, sumUsage } from '../hooks/panes/usage-scan'

const snap = (n: number, ctx: number, extra: Partial<Snap> = {}): Snap => ({ n, ctx, spent: 1000, cached: 900, usd: n * 0.1, ...extra })

test('efficiency is start load over current context, levels follow the config', async () => {
  const effs = turnEff([snap(1, 20000), snap(2, 40000), snap(3, 80000)])
  expect(effs.map(e => e.eff)).toEqual([100, 50, 25])
  expect(effLevel(50, DEFAULTS)).toBe('good')
  expect(effLevel(45, DEFAULTS)).toBe('warn')
  expect(effLevel(45, { effWarn: 30, effCaution: 45 })).toBe('good')
  expect(effVerdict(effs, DEFAULTS)?.level).toBe('bad')
  // The fixed load from the breakdown wins over the first context when known.
  expect(turnEff([snap(1, 40000, { fix: 10000 }), snap(2, 50000)])[1]?.eff).toBe(20)
})

test('waste turns, session pruning and limit pace', async () => {
  const w = wasteTurns([snap(1, 10000), snap(2, 40000), snap(3, 45000), snap(4, 70000)], 15000)
  expect(w.map(x => x.n)).toEqual([2, 4])
  const p = pruneOrder(['a', 'b', 'c'], 'b', 2)
  expect(p.order).toEqual(['c', 'b'])
  expect(p.drop).toEqual(['a'])
  const now = Date.parse('2026-10-28T12:00:00Z')
  const l = limitInfo({ kind: 'seven_day', percentUsed: 80, resetsAt: '2026-10-31T12:00:00Z' }, now)
  expect(Math.round(l.elapsed ?? 0)).toBe(57)
  expect(l.runOutMs !== undefined).toBe(true)
  expect(limitInfo({ kind: 'other', percentUsed: 10 }, now).elapsed).toBe(undefined)
})

test('usage scan counts each call once and skips subagent prompts as turns', async () => {
  const at = '2026-10-28T10:00:00Z'
  const call = (id: string) =>
    JSON.stringify({
      type: 'assistant',
      timestamp: at,
      message: { id, model: 'claude-sonnet-5', usage: { input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    })
  const prompt = JSON.stringify({ type: 'user', uuid: 'u1', timestamp: at, message: { content: 'hi' } })
  const main = [prompt, call('m1'), call('m2'), '{broken'].join('\n')
  const resumed = [prompt, call('m1')].join('\n')
  const sub = [JSON.stringify({ type: 'user', uuid: 'u2', timestamp: at, message: { content: 'task' } }), call('s1')].join('\n')
  const now = Date.parse('2026-10-28T12:00:00Z')
  const totals = sumUsage(
    [
      { name: 'p/a.jsonl', mtimeMs: now, text: main },
      { name: 'p/b.jsonl', mtimeMs: now, text: resumed },
      { name: 'p/a/subagents/agent-1.jsonl', mtimeMs: now, text: sub },
    ],
    now,
    { todayStartMs: Date.parse('2026-10-28T00:00:00Z') },
  )
  expect(totals?.today.spent).toBe(6000)
  expect(totals?.today.turns).toBe(1)
  expect(totals?.today.usd).toBe(0.05)
  expect(totals?.today.subUsd).toBe(0.02)
  expect(parseTranscript('p/x/subagents/y.jsonl', sub).turns.length).toBe(0)
  expect(sumUsage([], now)).toBe(undefined)
})

const PANE = {
  plugin: PLUGIN,
  component: 'Pane',
  requestId: PANE_EFF,
  props: {
    title: 'Token efficiency',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('turns are recorded, state is written, and the pane draws on each surface', async ($, on) => {
  const store = new Map<string, unknown>()
  const state = new Map<string, unknown>()
  on('state.set', (_, e, next) => {
    state.set(e.key, e.value)
    return next(e)
  })
  let ctx = 20000
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('clock.now', () => ({ value: Date.parse('2026-10-28T12:00:00Z') }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw new Error('missing')
  })
  on('fs.write', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: {
        tokens: ctx,
        window: 1000000,
        percent: Math.round((ctx / 1000000) * 100),
        breakdown: {
          categories: [
            { name: 'System prompt', tokens: 10000, color: '', isDeferred: false, kind: 'used' as const },
            { name: 'Messages', tokens: ctx - 10000, color: '', isDeferred: false, kind: 'used' as const },
          ],
          totalTokens: ctx,
        } as never,
      },
      rateLimits: [{ kind: 'seven_day', percentUsed: 30, resetsAt: '2026-11-01T12:00:00Z' }],
      cost: { usd: 1.5 },
    },
  }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 15000, cache_creation_input_tokens: 500, model: 'claude-opus-5' }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', usage })
  ctx = 50000
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', usage })

  expect((store.get('hist:sess-1') as unknown[]).length).toBe(2)
  expect(state.get('eff')).toBe(20)
  expect(state.get('startCtx')).toBe(10000)
  expect(state.get('window')).toBe(1000000)
  expect(state.get('ctxPercent')).toBe(5)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const verdict = await ui.find({ type: 'Text', text: /Efficiency poor · now 20%/ })
    expect(verdict !== undefined).toBe(true)
    await ui.unmount()
  }
})
