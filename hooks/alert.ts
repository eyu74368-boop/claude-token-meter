import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'

import type { Config } from './core/config'
import { defineStrings } from './core/i18n'
import { TURNS_CSV, TURNS_HEADER, WASTE_CSV, WASTE_HEADER } from './core/ids'
import { appendCsv, dataDirOf, join, rotateCsv } from './core/store'
import { TICK_MS } from './band'

// Session-size alerts (port of the old session_size_check hook), turn/waste logs, log rotation.
// Alerts reach the model (and a phone) as prompt context, and the desktop as a toast.

const lastReplyAt = atom({ plugin: 'claude-token-meter', key: 'lastReplyAt' } as const, 0)
const alertedStep = atom({ plugin: 'claude-token-meter', key: 'alertedStep' } as const, 100)
const effState = atom({ plugin: 'claude-token-meter', key: 'eff' } as const, 0)
const ctxState = atom({ plugin: 'claude-token-meter', key: 'ctx' } as const, 0)
const windowState = atom({ plugin: 'claude-token-meter', key: 'window' } as const, 0)
const startState = atom({ plugin: 'claude-token-meter', key: 'startCtx' } as const, 0)

const t = defineStrings({
  en: {
    effAlert:
      '[token-meter] Session efficiency {eff}% (context {ctx} of {window}, start load {start}). ' +
      'When the current task reaches a natural break, ask the user (yes/no) whether to move to a fresh session.',
    effToast: 'Session efficiency {eff}%: consider a fresh session',
    cacheAlert:
      '[token-meter] {idle} min since the last reply, so the prompt cache has expired: this message re-sends about {chat} ' +
      'of conversation uncached. Unless this request is short, first ask the user (yes/no) whether to move to a fresh session.',
    cacheToast: 'Cache expired after {idle} min: about {chat} re-sent uncached',
    startAlert:
      '[token-meter] Heavy start load: the first response used {start} tokens of context ' +
      '(check CLAUDE.md, MCP servers and skill lists).',
    startToast: 'Heavy start load: {start} on the first response',
  },
  ko: {
    effAlert:
      '[토큰 미터] 세션 효율 {eff}% (지금 컨텍스트 {ctx} / {window}, 시작 짐 {start}). ' +
      '지금 하던 일의 매듭이 나면 사용자에게 새 세션으로 옮길지 예/아니오로 물을 것.',
    effToast: '세션 효율 {eff}%: 새 세션을 고려하세요',
    cacheAlert:
      '[토큰 미터] 마지막 답 뒤 {idle}분이 지나 캐시가 만료됐습니다. 이번 메시지는 대화 약 {chat}를 캐시 없이 다시 씁니다. ' +
      '이번 요청이 짧은 일이 아니면 먼저 사용자에게 새 세션으로 옮길지 예/아니오로 물을 것.',
    cacheToast: '{idle}분 지나 캐시 만료: 대화 약 {chat} 다시 씀',
    startAlert: '[토큰 미터] 시작 짐 과다: 첫 응답 컨텍스트 {start} 토큰 (CLAUDE.md·MCP·스킬 목록 점검).',
    startToast: '시작 짐 과다: 첫 응답 {start}',
  },
})

// ---- pure helpers (exported for tests) ----

/** 12345 → "12.3k". */
export const fmtK = (n: number): string => `${(n / 1000).toFixed(1)}k`

/** Efficiency %: the fixed start load over the current context, 0..100 (0 when unknown). */
export const effOf = (startCtx: number, ctx: number): number =>
  startCtx > 0 && ctx > 0 ? Math.min(100, Math.round((startCtx * 100) / ctx)) : 0

/** The lowest alert step `eff` is below; 100 when it is below none. */
export function stepOf(eff: number, steps: readonly number[]): number {
  return steps.filter(s => eff < s).reduce((lo, s) => Math.min(lo, s), 100)
}

/**
 * What the efficiency step does at a prompt: `alert` the first time a lower step is crossed;
 * `step` is the value to keep (it rises again after /compact or /clear, so a later drop alerts anew).
 */
export function stepDecision(eff: number, steps: readonly number[], announced: number): { step: number; alert: boolean } {
  if (eff <= 0) return { step: announced, alert: false }
  const step = stepOf(eff, steps)
  return { step, alert: step < announced }
}

/** Minutes idle when the cache has expired and the conversation part is worth warning about; null otherwise. */
export function cacheExpiredMin(
  nowMs: number,
  lastAt: number,
  ctx: number,
  startCtx: number,
  eff: number,
  cfg: Pick<Config, 'cacheTtlMin' | 'cacheMinChat' | 'effCaution'>,
): number | null {
  if (lastAt <= 0 || ctx <= 0 || eff <= 0) return null
  const idle = (nowMs - lastAt) / 60000
  return idle >= cfg.cacheTtlMin && ctx - startCtx >= cfg.cacheMinChat && eff < cfg.effCaution ? Math.floor(idle) : null
}

/**
 * Per-session record this file keeps in `$.store`: previous context, its own copy of the start load
 * (so it never depends on hook order), turn count, pending start-load note.
 */
export type SessionRec = { ctx: number; start: number; turn: number; startNote: string; at: number }
export type SessionRecs = Record<string, SessionRec>
const RECS_KEY = 'alert.sessions'
const KEEP_RECS = 30

/** `recs` with `id` set to `rec`, keeping only the most recent sessions. */
export function putRec(recs: SessionRecs, id: string, rec: SessionRec): SessionRecs {
  const all: SessionRecs = { ...recs, [id]: rec }
  const ids = Object.keys(all).sort((a, b) => (all[b]?.at ?? 0) - (all[a]?.at ?? 0))
  const kept: SessionRecs = {}
  for (const k of ids.slice(0, KEEP_RECS)) {
    const r = all[k]
    if (r) kept[k] = r
  }
  return kept
}

const isRecs = (v: unknown): v is SessionRecs => typeof v === 'object' && v !== null && !Array.isArray(v)

const isoOf = (ms: number): string => (Number.isFinite(ms) ? new Date(ms).toISOString() : '')

export function installAlert(on: On, cfg: Config): void {
  // Tool names used in the current turn, for waste.csv (a reload only blanks one row's list).
  let turnTools = new Set<string>()

  on('session.start', { cwd: /$/ }, async ($, e, next) => {
    // The band's cache countdown redraws on this timer (one session.start hook for alert + band).
    $.clock.every(TICK_MS, () => void $.ui.invalidate('ui.render'))
    try {
      const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
      const now = await $.clock.now()
      for (const name of [TURNS_CSV, WASTE_CSV]) {
        const file = join(dataDirOf(home), name)
        if (!(await $.fs.exists(file))) continue
        const rotated = rotateCsv(String(await $.fs.read(file)), now, cfg.keepDays)
        if (rotated.dropped > 0) await $.fs.write(file, rotated.text)
      }
    } catch {
      // Rotation is housekeeping; never block the session on it.
    }
    return next(e)
  })

  on('tool.call', { tool: /^/ }, ($, e, next) => {
    turnTools.add(e.tool)
    return next(e)
  })

  on('prompt.submit', { text: /(?:)/ }, async ($, e, next) => {
    turnTools = new Set()
    if (e.isMeta) return next(e)
    const notes: string[] = []
    try {
      let ctx = await read($, ctxState)
      let window = await read($, windowState)
      if (ctx <= 0 || window <= 0) {
        const usage = await $.session.usage()
        ctx = usage.context.tokens ?? 0
        window = usage.context.window
      }
      const id = await $.session.id()
      const stored = await $.store.get(RECS_KEY)
      const recs = isRecs(stored) ? stored : {}
      const rec = recs[id]
      const startCtx = (await read($, startState)) || (rec?.start ?? 0)
      const eff = (await read($, effState)) || effOf(startCtx, ctx)
      if (rec && rec.startNote !== '') {
        notes.push(rec.startNote)
        await $.store.set(RECS_KEY, putRec(recs, id, { ...rec, startNote: '' }))
      }

      const announced = await read($, alertedStep)
      const decision = stepDecision(eff, cfg.alertSteps, announced)
      if (decision.step !== announced) await update($, alertedStep, () => decision.step)
      if (decision.alert) {
        notes.push(t('effAlert', { eff, ctx: fmtK(ctx), window: fmtK(window), start: fmtK(startCtx) }))
        $.ui.toast(t('effToast', { eff }))
      } else {
        const idle = cacheExpiredMin(await $.clock.now(), await read($, lastReplyAt), ctx, startCtx, eff, cfg)
        if (idle !== null) {
          const chat = fmtK(ctx - startCtx)
          notes.push(t('cacheAlert', { idle, chat }))
          $.ui.toast(t('cacheToast', { idle, chat }))
        }
      }
    } catch {
      // A failed reading never blocks the prompt.
    }
    return notes.length > 0 ? next({ ...e, context: [...(e.context ?? []), ...notes] }) : next(e)
  })

  on('turn.complete', { turnId: /^/ }, async ($, e, next) => {
    if (e.agentId) return next(e)
    try {
      const now = await $.clock.now()
      await update($, lastReplyAt, () => now)

      const usage = await $.session.usage()
      const ctx = usage.context.tokens ?? 0
      const window = usage.context.window
      const id = await $.session.id()
      const stored = await $.store.get(RECS_KEY)
      const recs = isRecs(stored) ? stored : {}
      const prev = recs[id]
      const turn = (prev?.turn ?? 0) + 1
      const startCtx = (await read($, startState)) || (prev ? prev.start : ctx)
      const eff = effOf(startCtx, ctx)
      const jump = prev ? ctx - prev.ctx : 0

      let startNote = prev?.startNote ?? ''
      if (!prev && ctx >= cfg.startPayload) {
        startNote = t('startAlert', { start: fmtK(ctx) })
        $.ui.toast(t('startToast', { start: fmtK(ctx) }))
      }
      await $.store.set(RECS_KEY, putRec(recs, id, { ctx, start: startCtx, turn, startNote, at: now }))

      const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
      const dir = dataDirOf(home)
      const at = isoOf(now)
      const sid = id.slice(0, 8)
      const turnsFile = join(dir, TURNS_CSV)
      const oldTurns = (await $.fs.exists(turnsFile)) ? String(await $.fs.read(turnsFile)) : ''
      const cached = e.usage?.cache_read_input_tokens ?? 0
      await $.fs.write(turnsFile, appendCsv(oldTurns, [at, sid, turn, ctx, window, eff, jump, cached], TURNS_HEADER))

      if (jump > cfg.wasteTokens) {
        const wasteFile = join(dir, WASTE_CSV)
        const oldWaste = (await $.fs.exists(wasteFile)) ? String(await $.fs.read(wasteFile)) : ''
        const tools = [...turnTools].sort().join(' ')
        await $.fs.write(wasteFile, appendCsv(oldWaste, [at, sid, turn, jump, ctx, tools], WASTE_HEADER))
      }
    } catch {
      // Logging never blocks the conversation.
    }
    return next(e)
  })
}
