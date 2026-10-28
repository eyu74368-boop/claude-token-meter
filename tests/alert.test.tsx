import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { cacheExpiredMin, effOf, putRec, stepDecision } from '../hooks/alert'
import { DEFAULTS } from '../hooks/core/config'

/** A data file by name: the engine hands `fs.write` an absolute path (`C:\home\u\...` on Windows). */
const dataFile = (files: Record<string, string>, name: string): string | undefined =>
  Object.entries(files).find(([k]) => k.replace(/\\/g, '/').endsWith(`/home/u/.claude/token-meter/${name}`))?.[1]

/** The engine beneath the mod: files in memory, a moving clock, a settable context. */
function world(on: On) {
  const files: Record<string, string> = {}
  const contexts: (readonly string[])[] = []
  const toasts: string[] = []
  const usage = { tokens: 0, window: 1000000 }
  const clock = mock.clock(on, { now: Date.parse('2026-10-28T00:00:00Z') })
  mock.store(on)
  mock.env(on, { HOME: '/home/u' })
  on('settings.read', () => ({ value: {} as never }))
  on('session.id', () => ({ value: 'session-abcdef12' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { tokens: usage.tokens, window: usage.window }, rateLimits: [] },
  }))
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('fs.read', (_, e) => ({ value: files[e.path] ?? '' }))
  on('fs.write', (_, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('prompt.submit', (_, e) => {
    contexts.push(e.context ?? [])
    return { text: e.text, context: e.context, origin: e.origin }
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', () => ({ result: {} }))
  return { files, contexts, toasts, usage, clock }
}

const PROMPT = { text: 'hi', wait: false, origin: { kind: 'composer' } } as const
const TURN = { answer: '', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

test('pure helpers: steps, cache expiry, efficiency, record pruning', () => {
  expect(effOf(60000, 150000)).toBe(40)
  expect(effOf(0, 150000)).toBe(0)
  expect(stepDecision(35, [40, 30, 22], 100)).toEqual({ step: 40, alert: true })
  expect(stepDecision(35, [40, 30, 22], 40)).toEqual({ step: 40, alert: false })
  expect(stepDecision(25, [40, 30, 22], 40)).toEqual({ step: 30, alert: true })
  expect(stepDecision(80, [40, 30, 22], 30)).toEqual({ step: 100, alert: false })
  const hour = 3600000
  expect(cacheExpiredMin(2 * hour, hour - 60000, 150000, 60000, 40, DEFAULTS)).toBe(61)
  expect(cacheExpiredMin(2 * hour, hour + 60000, 150000, 60000, 40, DEFAULTS)).toBe(null)
  expect(cacheExpiredMin(2 * hour, 1, 90000, 60000, 40, DEFAULTS)).toBe(null)
  expect(cacheExpiredMin(2 * hour, 1, 150000, 60000, 60, DEFAULTS)).toBe(null)
  let recs = {}
  for (let i = 0; i < 40; i++) recs = putRec(recs, `s${i}`, { ctx: 1, start: 1, turn: 1, startNote: '', at: i })
  expect(Object.keys(recs).length).toBe(30)
})

test('an efficiency step alerts once, as prompt context and a toast; a big jump is logged', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  w.usage.tokens = 50000
  await $.turn.complete(TURN)
  expect(dataFile(w.files, 'turns.csv')?.split('\n')[0]).toBe('time,session,turn,ctx,window,eff,jump,cached')
  expect(w.toasts.length).toBe(0)

  await $.tool.call({ tool: 'Bash', command: 'ls' })
  w.usage.tokens = 150000
  await $.turn.complete(TURN)
  expect((dataFile(w.files, 'waste.csv') ?? '').split('\n')[1]).toMatch(/,2,100000,150000,Bash$/)

  await $.prompt.submit(PROMPT)
  expect(w.contexts.at(-1)?.join('\n')).toMatch(/efficiency 33%/)
  expect(w.toasts.length).toBe(1)

  await $.prompt.submit(PROMPT)
  expect(w.contexts.at(-1)?.length ?? 0).toBe(0)
})

test('a heavy start load and an idle hour reach the next prompt', async ($, on) => {
  const w = world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  w.usage.tokens = 70000
  await $.turn.complete(TURN)
  expect(w.toasts.some(x => /Heavy start load/.test(x))).toBe(true)
  w.usage.tokens = 150000
  await $.turn.complete(TURN)

  await w.clock.advance(61 * 60000)
  await $.prompt.submit(PROMPT)
  const said = w.contexts.at(-1)?.join('\n') ?? ''
  expect(said).toMatch(/Heavy start load/)
  expect(said).toMatch(/61 min since the last reply/)
  expect(said).not.toMatch(/efficiency/)
})
