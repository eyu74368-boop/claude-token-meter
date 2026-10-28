import { atom, update } from 'claude-code'
import type { Hook, On } from 'claude-code'

import type { Config } from '../core/config'
import { defineStrings } from '../core/i18n'
import { CMD_EFF, PANE_EFF } from '../core/ids'
import { claudeDirOf, join } from '../core/store'
import { localDayStart, parseTranscript, sumParsed } from './usage-scan'
import type { FileUsage, Totals } from './usage-scan'

// Token efficiency pane: per-turn snapshots of this session (kept in `$.store`), efficiency =
// start load ÷ current context, charts, rate-limit bars, and today / 7-day totals across all
// transcripts. At turn end it writes the state keys this file owns (startCtx, ctx, window, eff,
// ctxPercent) for the band and the alert.

type Api = Parameters<Hook<'turn.complete'>>[0]

const t = defineStrings({
  en: {
    cmdDesc: 'Show token efficiency: start load vs. current context, per turn',
    paneTitle: 'Token efficiency',
    opened: 'Token efficiency pane opened.',
    noData: 'No data yet: it fills in after the first turn',
    noDataErr: 'No data yet: it fills in after the first turn (recording failed: {err})',
    effFirst: 'Efficiency appears after the first turn ends',
    good: '{dot} Efficiency good · now {eff}%',
    warn: '{dot} Efficiency dropping · now {eff}%',
    bad: '{dot} Efficiency poor · now {eff}%',
    trendDown: '↓ falling from the last 3 turns’ average of {avg}%',
    trendUp: '↑ better than the last 3 turns’ average of {avg}%',
    trendFlat: '→ about the same as the last turns',
    cost: 'each request costs about {ratio}x a fresh session (measured approximation)',
    hintGood: '{trend} — fine to keep going',
    hintWarn: '{trend} — {cost}. If more than {payback} turns of work remain, start a fresh session at a good stopping point',
    hintBad: '{trend} — {cost}. If more than {payback} turns of work remain, a fresh session (or /compact) now pays off',
    lineSession: 'This session: {turns} turns · {spent} tokens processed · ${usd} · last context {ctx}',
    lineToday: 'Today ({sessions} sessions): {turns} turns · {spent} tokens · ${usd}',
    line7: 'Last 7 days ({sessions} sessions): {turns} turns · {spent} tokens · ${usd}',
    linePerTurn: '{perTurn} tokens per turn · {cache}% read from cache',
    lineLimits: 'Usage limits: {limits}',
    cardSession: 'This session',
    cardToday: 'Today · {n} sessions',
    card7: 'Last 7 days · {n} sessions',
    turnsTokens: '{turns} turns · {spent} tokens',
    gaugeCtx: 'Context',
    gaugeCache: 'Read from cache',
    usdNote: '{perTurn} tokens per turn · amounts are API price equivalents',
    limitsTitle: '📅 Usage limits',
    noLimits: 'No subscription limit data yet',
    used: '{p}% used',
    elapsed: '{p}% of the window passed',
    pace: 'time mark',
    weekSpent: 'Spent this week {spent} tokens (${usd}) ÷ {p}% → weekly total about {total} tokens (${estUsd}) · about {left} left',
    weekSpentNoEst: 'Spent this week {spent} tokens — the total is estimated once over 1%',
    resetIn: 'resets in {d}',
    runOut: '⚠ {reset} · at this pace 100% in about {d} — before the reset',
    projected: '{reset}{sep}at this pace about {p}% at the reset ({state})',
    roomy: 'room to spare',
    tight: 'tight',
    totalsNote: 'The weekly total is estimated from all local transcripts (subagents ${sub} included); other devices and the web are not counted',
    totalsFallback: 'Estimated from this mod’s own recent session records only (transcripts unreadable), so it reads low',
    skipped: '{n} transcripts over 4 MiB were skipped',
    effTitle: '⚡ Efficiency per turn (100% = as light as a fresh session)',
    effLegend: '{good} {caution}%+ good · {warn} {warnPct}–{caution}% consider a fresh session at a stopping point · {bad} under {warnPct}% fresh session recommended',
    wasteHead: 'Turns that cut efficiency the most (over {min} tokens):',
    wasteRow: '  • turn {n} +{jump} tokens{tools}',
    ctxTitle: '📈 Context per turn',
    ctxAlt: 'Bar chart of context tokens per turn',
    catTitle: '🧩 Context right now',
    catNone: 'Could not read the breakdown',
    day: '{d}d {h}h',
    hour: '{h}h',
    limit_five_hour: '5-hour limit',
    limit_seven_day: '7-day limit',
    limit_seven_day_opus: '7-day limit (Opus)',
    limit_seven_day_sonnet: '7-day limit (Sonnet)',
    tipTurn: 'turn {n} · efficiency {eff}%',
    tipCtx: 'context {ctx} tokens{jump}',
    tipCache: 'read from cache {cache}%{cold}',
    tipCold: ' — cache missed, this turn read at full price',
    tipTools: 'tools: {tools}',
    tipBar: 'turn {n}: {ctx} tokens',
    guide: 'fresh-session line',
    effAxis: 'turns →  (hover = context · cache · tools of that turn, ! = cache missed)',
    ctxAxis: 'turns →  (bar = context tokens of that turn)',
    altTurn: 'turn {n} {eff}%',
    altWeek: '{kind} {p}% used, {e}% of the window passed',
  },
  ko: {
    cmdDesc: '토큰 효율 보기: 턴마다 시작 짐 대비 지금 컨텍스트',
    paneTitle: '토큰 효율',
    opened: '토큰 효율 창을 열었어요.',
    noData: '아직 기록 없음 — 첫 턴이 끝나면 쌓여요',
    noDataErr: '아직 기록 없음 — 첫 턴이 끝나면 쌓여요 (기록 실패: {err})',
    effFirst: '효율은 첫 턴이 끝나면 나와요',
    good: '{dot} 효율 좋음 · 지금 {eff}%',
    warn: '{dot} 효율 떨어지는 중 · 지금 {eff}%',
    bad: '{dot} 효율 나쁨 · 지금 {eff}%',
    trendDown: '↓ 직전 3턴 평균 {avg}%에서 내려가는 중',
    trendUp: '↑ 직전 3턴 평균 {avg}%보다 나아짐',
    trendFlat: '→ 직전 턴들과 비슷',
    cost: '요청마다 새 세션보다 약 {ratio}배 비용(실측 근사)',
    hintGood: '{trend} — 그대로 계속해도 돼요',
    hintWarn: '{trend} — {cost}. 남은 일이 {payback}턴 넘으면 매듭에서 새 세션을 여세요',
    hintBad: '{trend} — {cost}. 남은 일이 {payback}턴 넘으면 지금 새 세션(또는 /compact)이 이득이에요',
    lineSession: '이 세션 누적: {turns}턴 · 처리 {spent} 토큰 · ${usd} · 마지막 컨텍스트 {ctx}',
    lineToday: '오늘 누적 (세션 {sessions}개): {turns}턴 · 처리 {spent} 토큰 · ${usd}',
    line7: '최근 7일 누적 (세션 {sessions}개): {turns}턴 · 처리 {spent} 토큰 · ${usd}',
    linePerTurn: '턴당 처리 {perTurn} 토큰 · 캐시로 읽은 비율 {cache}%',
    lineLimits: '사용 한도: {limits}',
    cardSession: '이 세션',
    cardToday: '오늘 · 세션 {n}개',
    card7: '최근 7일 · 세션 {n}개',
    turnsTokens: '{turns}턴 · {spent} 토큰',
    gaugeCtx: '컨텍스트',
    gaugeCache: '캐시로 읽음',
    usdNote: '턴당 처리 {perTurn} 토큰 · 금액은 API 요금 환산',
    limitsTitle: '📅 사용 한도',
    noLimits: '구독 한도 정보가 아직 없어요',
    used: '{p}% 사용',
    elapsed: '기간 중 {p}% 지남',
    pace: '시간 기준선',
    weekSpent: '이번 주 쓴 양 {spent} 토큰 (${usd}) ÷ {p}% → 주간 총량 약 {total} 토큰 (${estUsd}) · 남은 약 {left}',
    weekSpentNoEst: '이번 주 쓴 양 {spent} 토큰 — 1% 넘게 쓰면 총량을 추정해요',
    resetIn: '리셋까지 {d}',
    runOut: '⚠ {reset} · 지금 속도면 약 {d} 뒤 100% — 리셋 전에 바닥나요',
    projected: '{reset}{sep}지금 속도면 리셋 때 약 {p}% ({state})',
    roomy: '여유',
    tight: '빠듯',
    totalsNote: '주간 총량은 이 PC의 모든 대화 기록 합산(하위 에이전트 ${sub} 포함)으로 거꾸로 잰 추정치예요 (다른 기기·웹 사용분은 빠짐)',
    totalsFallback: '대화 기록을 못 읽어 이 모드의 최근 세션 기록만으로 잰 추정치예요 — 실제보다 작게 나와요',
    skipped: '4 MiB 넘는 대화 기록 {n}개는 건너뛰었어요',
    effTitle: '⚡ 턴별 효율 (100% = 새 세션만큼 가벼움)',
    effLegend: '{good} {caution}% 이상 좋음 · {warn} {warnPct}~{caution}% 매듭에서 새 세션 고려 · {bad} {warnPct}% 아래 새 세션 권장',
    wasteHead: '효율을 크게 떨어뜨린 턴 ({min} 토큰 넘게 늘어남):',
    wasteRow: '  • {n}턴 +{jump} 토큰{tools}',
    ctxTitle: '📈 턴별 컨텍스트',
    ctxAlt: '턴별 컨텍스트 토큰 막대그래프',
    catTitle: '🧩 지금 컨텍스트 구성',
    catNone: '구성을 못 읽었어요',
    day: '{d}일 {h}시간',
    hour: '{h}시간',
    limit_five_hour: '5시간 한도',
    limit_seven_day: '7일 한도',
    limit_seven_day_opus: '7일 한도(Opus)',
    limit_seven_day_sonnet: '7일 한도(Sonnet)',
    tipTurn: '{n}턴 · 효율 {eff}%',
    tipCtx: '컨텍스트 {ctx} 토큰{jump}',
    tipCache: '캐시로 읽음 {cache}%{cold}',
    tipCold: ' — 캐시 끊김, 이 턴은 비싸게 읽음',
    tipTools: '도구: {tools}',
    tipBar: '{n}턴: {ctx} 토큰',
    guide: '새 세션 권장선',
    effAxis: '턴 →  (막대에 마우스 = 그 턴 컨텍스트·캐시·쓴 도구, ! = 캐시 끊김)',
    ctxAxis: '턴 →  (막대 = 그 턴의 컨텍스트 토큰)',
    altTurn: '{n}턴 {eff}%',
    altWeek: '{kind} {p}% 사용, 기간 중 {e}% 지남',
  },
})

// ---- state this file owns ----
const stStartCtx = atom({ plugin: 'claude-token-meter', key: 'startCtx' } as const, 0)
const stCtx = atom({ plugin: 'claude-token-meter', key: 'ctx' } as const, 0)
const stWindow = atom({ plugin: 'claude-token-meter', key: 'window' } as const, 0)
const stEff = atom({ plugin: 'claude-token-meter', key: 'eff' } as const, 0)
const stCtxPercent = atom({ plugin: 'claude-token-meter', key: 'ctxPercent' } as const, 0)

// ---- per-turn snapshots ----
/** One finished main-loop turn. `fix` = the fixed load (context minus conversation) when the breakdown was readable. */
export type Snap = { n: number; ctx: number; spent: number; cached: number; usd: number; tools?: string[]; at?: number; fix?: number }

const KEEP_SESSIONS = 30
const KEEP_TURNS = 400
const histKey = (id: string): string => `hist:${id}`

export const k = (n: number): string =>
  n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(Math.round(n))
export const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0)
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const asSnaps = (v: unknown): Snap[] =>
  Array.isArray(v) ? v.filter((s): s is Snap => !!s && typeof s === 'object' && typeof (s as Snap).ctx === 'number') : []

/** Session order after `current` is seen, and the sessions to drop past `keep`. */
export function pruneOrder(order: readonly string[], current: string, keep = KEEP_SESSIONS): { order: string[]; drop: string[] } {
  const next = order.filter(x => x !== current)
  next.push(current)
  const cut = Math.max(0, next.length - keep)
  return { order: next.slice(cut), drop: next.slice(0, cut) }
}

export function summarize(list: readonly Snap[]) {
  const last = list.at(-1)
  const spent = list.reduce((s, x) => s + x.spent, 0)
  const cached = list.reduce((s, x) => s + x.cached, 0)
  return {
    turns: list.length,
    ctx: last?.ctx ?? 0,
    usd: last?.usd ?? 0,
    spent,
    perTurn: list.length ? Math.round(spent / list.length) : 0,
    cacheRate: pct(cached, spent),
  }
}

/** Fixed load of a breakdown: every used category except the conversation, free space and buffers. */
export function fixedLoad(categories: readonly { name: string; tokens: number; kind: string }[] | undefined): number | undefined {
  if (!categories?.length) return undefined
  const n = categories.filter(c => c.kind === 'used' && !/message|free|buffer|compact/i.test(c.name)).reduce((s, c) => s + c.tokens, 0)
  return n > 0 ? n : undefined
}

/** Start load: the smallest fixed load seen, else the first non-zero context. 0 when unknown. */
export function startLoad(list: readonly Snap[]): number {
  const fixes = list.map(s => s.fix ?? 0).filter(c => c > 0)
  if (fixes.length) return Math.min(...fixes)
  return list.find(s => s.ctx > 0)?.ctx ?? 0
}

export type Eff = { n: number; eff: number; ctx: number; jump: number; cache: number; tools: string[] }
export function turnEff(list: readonly Snap[]): Eff[] {
  const base = startLoad(list)
  if (base <= 0) return []
  return list.map((s, i) => ({
    n: s.n,
    eff: Math.min(100, Math.round((base / Math.max(1, s.ctx)) * 100)),
    ctx: s.ctx,
    jump: i > 0 ? s.ctx - list[i - 1]!.ctx : 0,
    cache: pct(s.cached, s.spent),
    tools: s.tools ?? [],
  }))
}

export type Level = 'good' | 'warn' | 'bad'
export const effLevel = (eff: number, cfg: Pick<Config, 'effWarn' | 'effCaution'>): Level =>
  eff >= cfg.effCaution ? 'good' : eff >= cfg.effWarn ? 'warn' : 'bad'
const LEVEL_COLOR: Record<Level, string> = { good: '#2fb57c', warn: '#e8924a', bad: '#d65b6f' }
const LEVEL_DOT: Record<Level, string> = { good: '🟢', warn: '🟠', bad: '🔴' }
const LEVEL_TEXT_COLOR: Record<Level, string> = { good: 'green', warn: 'yellow', bad: 'red' }

// Real cost of one request vs. a fresh session. It grows slower than the context ratio (100/eff):
// output and cache writes cost the same at any size. Measured over 1,439 turns: ≈ 1 + 0.37 × (100/eff − 1).
const COST_SLOPE = 0.37
export const costRatio = (eff: number): number => Math.round(Math.max(1, 1 + COST_SLOPE * (100 / Math.max(1, eff) - 1)) * 10) / 10
/** Turns after which a fresh session (≈ one ordinary turn to set up) has paid for itself. */
export const paybackTurns = (ratio: number): number => (ratio > 1 ? Math.ceil(1 / (ratio - 1)) : Infinity)

export function effVerdict(effs: readonly Eff[], cfg: Pick<Config, 'effWarn' | 'effCaution'>): { level: Level; now: number; text: string; hint: string } | undefined {
  const last = effs.at(-1)
  if (!last) return undefined
  const level = effLevel(last.eff, cfg)
  const prev = effs.slice(-4, -1)
  const avg = prev.length ? Math.round(prev.reduce((s, x) => s + x.eff, 0) / prev.length) : last.eff
  const trend = last.eff < avg - 2 ? t('trendDown', { avg }) : last.eff > avg + 2 ? t('trendUp', { avg }) : t('trendFlat')
  const ratio = costRatio(last.eff)
  const cost = t('cost', { ratio })
  const payback = paybackTurns(ratio)
  const text = t(level, { dot: LEVEL_DOT[level], eff: last.eff })
  const hint = level === 'good' ? t('hintGood', { trend }) : t(level === 'warn' ? 'hintWarn' : 'hintBad', { trend, cost, payback })
  return { level, now: last.eff, text, hint }
}

/** Turns whose context grew by at least `min` tokens, biggest first. */
export function wasteTurns(list: readonly Snap[], min: number): { n: number; jump: number; ctx: number; tools: string[] }[] {
  const out: { n: number; jump: number; ctx: number; tools: string[] }[] = []
  list.forEach((s, i) => {
    const jump = i > 0 ? s.ctx - list[i - 1]!.ctx : 0
    if (i > 0 && jump >= min) out.push({ n: s.n, jump, ctx: s.ctx, tools: s.tools ?? [] })
  })
  return out.sort((a, b) => b.jump - a.jump)
}

/** Local calendar day (YYYY-MM-DD). */
export const dayOf = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Totals from the mod's own snapshots, for when transcripts cannot be read. Cost is cumulative per session, so each turn adds its difference. */
export function rangeTotal(hists: readonly Snap[][], start: number, end: number): { sessions: number; turns: number; spent: number; usd: number } {
  const out = { sessions: 0, turns: 0, spent: 0, usd: 0 }
  for (const list of hists) {
    let hit = false
    list.forEach((s, i) => {
      if (s.at === undefined || s.at < start || s.at > end) return
      hit = true
      out.turns += 1
      out.spent += s.spent
      out.usd += Math.max(0, s.usd - (i > 0 ? list[i - 1]!.usd : 0))
    })
    if (hit) out.sessions += 1
  }
  return out
}

// ---- rate limits ----
const HOUR_MS = 3600000
const WEEK_MS = 7 * 24 * HOUR_MS
export const limitWindowMs = (kind: string): number | undefined =>
  kind === 'five_hour' ? 5 * HOUR_MS : kind.startsWith('seven_day') ? WEEK_MS : undefined

export type Limit = {
  kind: string
  percent: number
  /** % of the window already passed; undefined when the window length is unknown. */
  elapsed?: number
  projected?: number
  resetMs?: number
  runOutMs?: number
}

export function limitInfo(r: { kind: string; percentUsed: number; resetsAt?: string }, now: number): Limit {
  const percent = Math.round(r.percentUsed)
  const win = limitWindowMs(r.kind)
  const resetAt = r.resetsAt ? Date.parse(r.resetsAt) : NaN
  if (!win || !Number.isFinite(resetAt)) return { kind: r.kind, percent }
  const start = resetAt - win
  const elapsed = Math.min(100, Math.max(0.1, ((now - start) / win) * 100))
  const resetMs = Math.max(0, resetAt - now)
  const rate = r.percentUsed / Math.max(1, now - start)
  const runOut = rate > 0 ? (100 - r.percentUsed) / rate : Infinity
  return {
    kind: r.kind,
    percent,
    elapsed,
    projected: Math.round((r.percentUsed / elapsed) * 100),
    resetMs,
    runOutMs: runOut < resetMs ? runOut : undefined,
  }
}

export const limitName = (kind: string): string => {
  switch (kind) {
    case 'five_hour':
      return t('limit_five_hour')
    case 'seven_day':
      return t('limit_seven_day')
    case 'seven_day_opus':
      return t('limit_seven_day_opus')
    case 'seven_day_sonnet':
      return t('limit_seven_day_sonnet')
    default:
      return kind.replace(/_/g, ' ')
  }
}

export const dur = (ms: number): string => {
  const h = Math.round(ms / HOUR_MS)
  return h >= 24 ? t('day', { d: Math.floor(h / 24), h: h % 24 }) : t('hour', { h })
}

/** One line under a limit bar: run-out warning, or where the pace lands at the reset. */
export function paceLine(l: Limit): string | undefined {
  if (l.projected === undefined) return undefined
  const reset = l.resetMs !== undefined ? t('resetIn', { d: dur(l.resetMs) }) : ''
  if (l.runOutMs !== undefined) return t('runOut', { reset, d: dur(l.runOutMs) })
  return t('projected', { reset, sep: reset ? ' · ' : '', p: Math.min(999, l.projected), state: l.projected <= 100 ? t('roomy') : t('tight') })
}

// ---- drawings ----
const svgWrap = (W: number, H: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="sans-serif">${body}</svg>`

/** Bars = context tokens per turn (what the next request reads again). */
export function chartSvg(list: readonly Snap[]): string {
  const W = 640
  const H = 240
  const L = 46
  const B = 28
  const T = 16
  const max = Math.max(1000, ...list.map(s => s.ctx))
  const bw = (W - L - 10) / Math.max(list.length, 8)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  const parts: string[] = []
  for (const f of [0, 0.5, 1]) {
    const yy = y(max * f)
    parts.push(`<line x1="${L}" x2="${W - 6}" y1="${yy}" y2="${yy}" stroke="#8884" />`)
    parts.push(`<text x="${L - 6}" y="${yy + 4}" text-anchor="end" font-size="11" fill="#888">${k(max * f)}</text>`)
  }
  list.forEach((s, i) =>
    parts.push(
      `<rect x="${L + i * bw + 1}" y="${y(s.ctx)}" width="${Math.max(1, bw - 2)}" height="${H - B - y(s.ctx)}" fill="#5b7cfa" rx="2"><title>${esc(t('tipBar', { n: s.n, ctx: k(s.ctx) }))}</title></rect>`,
    ),
  )
  parts.push(`<text x="${L}" y="${H - 8}" font-size="11" fill="#888">${esc(t('ctxAxis'))}</text>`)
  return svgWrap(W, H, parts.join(''))
}

export function sparkline(list: readonly Snap[]): string {
  const marks = '▁▂▃▄▅▆▇█'
  const max = Math.max(1, ...list.map(s => s.ctx))
  return list
    .slice(-60)
    .map(s => marks[Math.min(7, Math.floor((s.ctx / max) * 7.999))])
    .join('')
}

/** Efficiency bars coloured by level; a turn whose cache read rate fell under 50% gets a "!". */
export function effSvg(effs: readonly Eff[], cfg: Pick<Config, 'effWarn' | 'effCaution'>): string {
  const W = 640
  const H = 200
  const L = 40
  const B = 26
  const T = 14
  const bw = Math.min(28, (W - L - 10) / Math.max(effs.length, 1))
  const y = (v: number) => T + (H - T - B) * (1 - v / 100)
  const parts: string[] = []
  const guides: [number, string, string][] = [
    [100, '#8886', ''],
    [cfg.effCaution, '#2fb57c99', '4 3'],
    [cfg.effWarn, '#d65b6f', '5 3'],
  ]
  for (const [v, color, dash] of guides) {
    parts.push(`<line x1="${L}" x2="${W - 6}" y1="${y(v)}" y2="${y(v)}" stroke="${color}" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`)
    parts.push(`<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="#888">${v}%</text>`)
  }
  parts.push(`<text x="${W - 8}" y="${y(cfg.effWarn) - 4}" text-anchor="end" font-size="11" fill="#d65b6f">${esc(t('guide'))}</text>`)
  effs.forEach((e, i) => {
    const x = L + i * bw + 1
    const w = Math.max(1, bw - 2)
    const isCold = i > 0 && e.cache < 50
    const tip = [
      t('tipTurn', { n: e.n, eff: e.eff }),
      t('tipCtx', { ctx: k(e.ctx), jump: e.jump ? ` (${e.jump > 0 ? '+' : ''}${k(e.jump)})` : '' }),
      t('tipCache', { cache: e.cache, cold: isCold ? t('tipCold') : '' }),
      e.tools.length ? t('tipTools', { tools: e.tools.slice(0, 6).join(', ') }) : '',
    ]
      .filter(Boolean)
      .join('\n')
    const mark = isCold ? `<text x="${x + w / 2}" y="${y(e.eff) - 3}" text-anchor="middle" font-size="11" font-weight="700" fill="#e8924a">!</text>` : ''
    parts.push(
      `<g><title>${esc(tip)}</title><rect x="${x}" y="${T}" width="${w}" height="${H - B - T}" fill="transparent"/><rect x="${x}" y="${y(e.eff)}" width="${w}" height="${H - B - y(e.eff)}" rx="2" fill="${LEVEL_COLOR[effLevel(e.eff, cfg)]}"/>${mark}</g>`,
    )
  })
  parts.push(`<text x="${L}" y="${H - 8}" font-size="11" fill="#888">${esc(t('effAxis'))}</text>`)
  return svgWrap(W, H, parts.join(''))
}

/** Limit bar: fill = % used; dashed mark = % of the window passed (fill past the mark = fast pace). */
export function limitSvg(l: Limit): string {
  const W = 640
  const H = l.elapsed === undefined ? 40 : 58
  const by = 22
  const r = Math.min(1, l.percent / 100)
  const level: Level = (l.projected ?? 0) > 100 ? 'bad' : l.elapsed !== undefined && l.percent > l.elapsed ? 'warn' : 'good'
  const parts = [
    `<text x="0" y="14" font-size="13" font-weight="600" fill="#ddd">${esc(`${limitName(l.kind)} · ${t('used', { p: l.percent })}`)}</text>`,
    `<rect x="0" y="${by}" width="${W}" height="14" rx="7" fill="#8883"/>`,
    r > 0 ? `<rect x="0" y="${by}" width="${Math.max(6, W * r)}" height="14" rx="7" fill="${LEVEL_COLOR[level]}"/>` : '',
  ]
  if (l.elapsed !== undefined) {
    const mx = (W * l.elapsed) / 100
    const anchor = mx > W - 60 ? 'end' : mx < 60 ? 'start' : 'middle'
    parts.push(`<text x="${W}" y="14" font-size="11" text-anchor="end" fill="#999">${esc(t('elapsed', { p: Math.round(l.elapsed) }))}</text>`)
    parts.push(`<line x1="${mx}" x2="${mx}" y1="${by - 4}" y2="${by + 18}" stroke="#ddd" stroke-dasharray="3 2"/>`)
    parts.push(`<text x="${Math.min(W - 2, Math.max(2, mx))}" y="${H - 4}" font-size="10" text-anchor="${anchor}" fill="#999">${esc(t('pace'))}</text>`)
  }
  return svgWrap(W, H, parts.join(''))
}

export type Card = { title: string; usd: number; turns: number; spent: number }
export type Gauge = { label: string; value: string; ratio: number; isHighGood?: boolean }
/** Top summary: total cards (session / today / 7 days) over gauges (context, cache, limits). */
export function summarySvg(cards: readonly Card[], gauges: readonly Gauge[]): string {
  const W = 640
  const G = 10
  const CH = 82
  const GH = 54
  const parts: string[] = []
  const box = (x: number, y: number, w: number, h: number) =>
    `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="8" fill="#8881" stroke="#8883"/>`
  const cw = (W - G * (cards.length - 1)) / Math.max(1, cards.length)
  cards.forEach((c, i) => {
    const x = i * (cw + G)
    parts.push(box(x, 0, cw, CH))
    parts.push(`<text x="${x + 14}" y="22" font-size="12" fill="#999">${esc(c.title)}</text>`)
    parts.push(`<text x="${x + 14}" y="51" font-size="22" font-weight="600" fill="#ddd">$${c.usd.toFixed(2)}</text>`)
    parts.push(`<text x="${x + 14}" y="70" font-size="12" fill="#aaa">${esc(t('turnsTokens', { turns: c.turns, spent: k(c.spent) }))}</text>`)
  })
  const gy = CH + G
  const gw = (W - G * (gauges.length - 1)) / Math.max(1, gauges.length)
  gauges.forEach((g, i) => {
    const x = i * (gw + G)
    const r = Math.min(1, Math.max(0, g.ratio))
    const color = g.isHighGood ? (r >= 0.5 ? '#2fb57c' : '#e8924a') : r >= 0.8 ? '#d65b6f' : r >= 0.5 ? '#e8924a' : '#2fb57c'
    parts.push(box(x, gy, gw, GH))
    parts.push(`<text x="${x + 12}" y="${gy + 21}" font-size="11" fill="#999">${esc(g.label)}</text>`)
    parts.push(`<text x="${x + gw - 12}" y="${gy + 21}" font-size="12" font-weight="600" text-anchor="end" fill="#ddd">${esc(g.value)}</text>`)
    parts.push(`<rect x="${x + 12}" y="${gy + 33}" width="${gw - 24}" height="8" rx="4" fill="#8883"/>`)
    if (r > 0) parts.push(`<rect x="${x + 12}" y="${gy + 33}" width="${Math.max(4, (gw - 24) * r)}" height="8" rx="4" fill="${color}"/>`)
  })
  return svgWrap(W, gauges.length ? gy + GH : CH, parts.join(''))
}

/** Context breakdown as horizontal bars (category names as /context shows them). */
export function catSvg(cats: readonly { name: string; tokens: number }[]): string {
  const rows = cats.filter(c => c.tokens > 0)
  const W = 640
  const RH = 24
  const LW = 170
  const max = Math.max(1, ...rows.map(c => c.tokens))
  const total = rows.reduce((s, c) => s + c.tokens, 0)
  const colors = ['#5b7cfa', '#2fb57c', '#e8924a', '#c45bd6', '#3fb4d0', '#d6b43f', '#d65b6f', '#7c8a99']
  const parts = rows.map((c, i) => {
    const y = 4 + i * RH
    const w = Math.max(2, ((W - LW - 90) * c.tokens) / max)
    return `<g><title>${esc(`${c.name} — ${k(c.tokens)}, ${pct(c.tokens, total)}%`)}</title><text x="0" y="${y + 16}" font-size="12" fill="#bbb">${esc(c.name.slice(0, 26))}</text><rect x="${LW}" y="${y + 4}" width="${w}" height="${RH - 10}" rx="3" fill="${colors[i % colors.length]}"/><text x="${LW + w + 6}" y="${y + 16}" font-size="12" fill="#bbb">${k(c.tokens)}</text></g>`
  })
  return svgWrap(W, rows.length * RH + 8, parts.join(''))
}

// ---- engine-side helpers (`$` stays in this file) ----
async function readHist($: Api, id: string): Promise<Snap[]> {
  return asSnaps(await $.store.get(histKey(id)))
}

async function readOrder($: Api): Promise<string[]> {
  const v = await $.store.get('order')
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

async function homeDir($: Api): Promise<string> {
  return (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '.'
}

// Transcript scan: files modified in the last SCAN_DAYS, parse cached per file by size + mtime,
// whole scan at most once per SCAN_TTL_MS. Files over 4 MiB cannot be read by `$.fs.read`.
const SCAN_DAYS = 8
const SCAN_TTL_MS = 60_000
const MAX_READ = 4 * 1024 * 1024
const parsed = new Map<string, { size: number; mtimeMs: number; usage: FileUsage }>()
let lastScan: { at: number; weekStartMs: number; totals?: Totals; skipped: number } | undefined

async function scanTotals($: Api, now: number, weekStartMs: number): Promise<{ totals?: Totals; skipped: number }> {
  if (lastScan && now - lastScan.at < SCAN_TTL_MS && lastScan.weekStartMs === weekStartMs) return lastScan
  const root = join(claudeDirOf(await homeDir($)), 'projects')
  const floor = now - SCAN_DAYS * 86400000
  const seen = new Set<string>()
  let skipped = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries: { name: string; kind: string; size: number; mtimeMs: number }[]
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const f of entries) {
      const path = join(dir, f.name)
      if (f.kind === 'dir' && depth < 3) await walk(path, depth + 1)
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.mtimeMs < floor) continue
      if (f.size >= MAX_READ) {
        skipped += 1
        continue
      }
      seen.add(path)
      const old = parsed.get(path)
      if (old && old.size === f.size && old.mtimeMs === f.mtimeMs) continue
      try {
        parsed.set(path, { size: f.size, mtimeMs: f.mtimeMs, usage: parseTranscript(path.slice(root.length), await $.fs.read(path)) })
      } catch {
        skipped += 1
      }
    }
  }
  try {
    if (await $.fs.exists(root)) await walk(root, 0)
  } catch {
    // unreadable: fall back to the mod's own records
  }
  for (const key of [...parsed.keys()]) if (!seen.has(key)) parsed.delete(key)
  const files = [...parsed.values()].map(p => p.usage)
  const totals = files.length ? sumParsed(files, now, { weekStartMs, todayStartMs: localDayStart(now) }) : undefined
  lastScan = { at: now, weekStartMs, totals, skipped }
  return lastScan
}

// Tools the main loop called during the current turn (for the waste list and bar tooltips).
const turnTools = new Set<string>()

// The engine refuses a second hook on one event without a matcher (register.tsx and the other
// panes hook the same events), so these carry an always-true RegExp matcher on a field every
// event of that kind has.
export function installEfficiency(on: On, cfg: Config): void {
  on('session.start', { cwd: /(?:)/ }, async ($, e, next) => {
    await $.command.register({ name: CMD_EFF, description: t('cmdDesc') })
    return next(e)
  })

  on('command.run', { command: CMD_EFF }, async $ => {
    await $.ui.open({ id: PANE_EFF, title: t('paneTitle') })
    return { text: t('opened') }
  })

  on('tool.call', { tool: /(?:)/ }, async ($, e, next) => {
    if (!e.agentId) turnTools.add(e.tool)
    return next(e)
  })

  on('turn.complete', { turnId: /(?:)/ }, async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const tools = [...turnTools].sort().slice(0, 12)
    turnTools.clear()
    try {
      const id = await $.session.id()
      const usage = await $.session.usage({ breakdown: 'summary' })
      const u = e.usage
      const list = await readHist($, id)
      const snap: Snap = {
        n: list.length + 1,
        ctx: usage.context.tokens ?? 0,
        spent: u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : 0,
        cached: u ? u.cache_read_input_tokens : 0,
        usd: usage.cost?.usd ?? 0,
        tools,
        at: Number(await $.clock.now()),
        fix: fixedLoad(usage.context.breakdown?.categories),
      }
      list.push(snap)
      await $.store.set(histKey(id), list.slice(-KEEP_TURNS))
      if (list.length === 1) {
        const { order, drop } = pruneOrder(await readOrder($), id)
        for (const old of drop) await $.store.delete(histKey(old))
        await $.store.set('order', order)
      }
      const start = startLoad(list)
      const win = usage.context.window ?? 0
      const eff = snap.ctx > 0 && start > 0 ? Math.min(100, Math.round((start / snap.ctx) * 100)) : 0
      await update($, stStartCtx, () => start)
      await update($, stCtx, () => snap.ctx)
      await update($, stWindow, () => win)
      await update($, stEff, () => eff)
      await update($, stCtxPercent, () => usage.context.percent ?? (win > 0 ? pct(snap.ctx, win) : 0))
      await $.store.delete('histErr')
      $.ui.invalidate('ui.render')
    } catch (err) {
      // Recording never blocks the conversation; the reason shows in the pane.
      await $.store.set('histErr', String((err as { message?: unknown })?.message ?? err)).catch(() => {})
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PANE_EFF }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    const id = await $.session.id()
    const list = await readHist($, id)
    const histErr = (await $.store.get('histErr')) as string | undefined
    let usage: Awaited<ReturnType<typeof $.session.usage>>
    try {
      usage = await $.session.usage({ breakdown: 'summary' })
    } catch {
      usage = await $.session.usage()
    }
    const cur = summarize(list)
    const curUsd = usage.cost?.usd ?? cur.usd
    const now = Number(await $.clock.now())
    const sevenDay = usage.rateLimits.find(r => r.kind === 'seven_day')
    const resetAt = sevenDay?.resetsAt ? Date.parse(sevenDay.resetsAt) : NaN
    const weekStartMs = Number.isFinite(resetAt) ? resetAt - WEEK_MS : now - WEEK_MS
    const scan = await scanTotals($, now, weekStartMs)
    const totals = scan.totals
    let day = totals?.today
    let week = totals?.last7
    let weekSpent = totals?.week
    if (!totals) {
      const hists: Snap[][] = []
      for (const sid of new Set([...(await readOrder($)), id])) hists.push(sid === id ? list : await readHist($, sid))
      day = { ...rangeTotal(hists, localDayStart(now), now + 60_000), subUsd: 0 }
      week = { ...rangeTotal(hists, now - WEEK_MS, now + 60_000), subUsd: 0 }
      weekSpent = { ...rangeTotal(hists, weekStartMs, now + 60_000), subUsd: 0 }
    }
    const d = day ?? { sessions: 0, turns: 0, spent: 0, usd: 0, subUsd: 0 }
    const w7 = week ?? d
    const limits = usage.rateLimits.map(r => limitInfo(r, now))
    const lines = [
      t('lineSession', { turns: cur.turns, spent: k(cur.spent), usd: curUsd.toFixed(2), ctx: k(cur.ctx) }),
      t('lineToday', { sessions: d.sessions, turns: d.turns, spent: k(d.spent), usd: d.usd.toFixed(2) }),
      t('line7', { sessions: w7.sessions, turns: w7.turns, spent: k(w7.spent), usd: w7.usd.toFixed(2) }),
      t('linePerTurn', { perTurn: k(cur.perTurn), cache: cur.cacheRate }),
    ]
    if (limits.length) lines.push(t('lineLimits', { limits: limits.map(l => `${limitName(l.kind)} ${l.percent}%`).join(' · ') }))

    const effs = turnEff(list)
    const verdict = effVerdict(effs, cfg)
    const worst = wasteTurns(list, cfg.wasteTokens).slice(0, 3)
    const wasteLines = worst.map(x => t('wasteRow', { n: x.n, jump: k(x.jump), tools: x.tools.length ? ` — ${x.tools.slice(0, 4).join(', ')}` : '' }))

    const weekLine = (() => {
      const wk = limits.find(l => l.kind === 'seven_day')
      if (!wk || !weekSpent) return undefined
      if (wk.percent < 1 || weekSpent.spent <= 0) return t('weekSpentNoEst', { spent: k(weekSpent.spent) })
      const total = weekSpent.spent / (wk.percent / 100)
      return t('weekSpent', {
        spent: k(weekSpent.spent),
        usd: weekSpent.usd.toFixed(2),
        p: wk.percent,
        total: k(total),
        estUsd: (weekSpent.usd / (wk.percent / 100)).toFixed(0),
        left: k(total - weekSpent.spent),
      })
    })()
    const paceLines = limits.map(l => ({ l, pace: paceLine(l) }))
    const noData = histErr ? t('noDataErr', { err: histErr }) : t('noData')

    if (!('Svg' in els)) {
      return (
        <Box flexDirection="column">
          <Text>{list.length ? sparkline(list) : noData}</Text>
          {verdict ? <Text color={LEVEL_TEXT_COLOR[verdict.level]}>{`${verdict.text} — ${verdict.hint}`}</Text> : null}
          {lines.map(line => (
            <Text dimColor>{line}</Text>
          ))}
          {weekLine ? <Text dimColor>{weekLine}</Text> : null}
          {paceLines.map(({ l, pace }) =>
            pace ? <Text color={l.runOutMs !== undefined ? 'red' : undefined} dimColor={l.runOutMs === undefined}>{`${limitName(l.kind)}: ${pace}`}</Text> : null,
          )}
          {wasteLines.length ? <Text>{t('wasteHead', { min: k(cfg.wasteTokens) })}</Text> : null}
          {wasteLines.map(line => (
            <Text>{line}</Text>
          ))}
        </Box>
      )
    }

    const { Svg } = els
    const win = usage.context.window ?? 0
    const ctxNow = usage.context.tokens ?? cur.ctx
    const cards: Card[] = [
      { title: t('cardSession'), usd: curUsd, turns: cur.turns, spent: cur.spent },
      { title: t('cardToday', { n: d.sessions }), usd: d.usd, turns: d.turns, spent: d.spent },
      { title: t('card7', { n: w7.sessions }), usd: w7.usd, turns: w7.turns, spent: w7.spent },
    ]
    const gauges: Gauge[] = [
      { label: t('gaugeCtx'), value: win ? `${k(ctxNow)} / ${k(win)}` : k(ctxNow), ratio: win ? ctxNow / win : 0 },
      { label: t('gaugeCache'), value: `${cur.cacheRate}%`, ratio: cur.cacheRate / 100, isHighGood: true },
    ]
    const cats = (usage.context.breakdown?.categories ?? []).filter(c => c.kind !== 'free' && c.tokens > 0).sort((a, b) => b.tokens - a.tokens)
    const gap = <Text> </Text>
    return (
      <Box flexDirection="column">
        {verdict ? (
          <Text bold color={LEVEL_TEXT_COLOR[verdict.level]}>
            {verdict.text}
          </Text>
        ) : (
          <Text dimColor>{t('effFirst')}</Text>
        )}
        {verdict ? <Text>{verdict.hint}</Text> : null}
        {gap}

        <Svg source={summarySvg(cards, gauges)} alt={lines.join(' / ')} />
        <Text dimColor>{t('usdNote', { perTurn: k(cur.perTurn) })}</Text>
        {gap}

        <Text bold>{t('limitsTitle')}</Text>
        {limits.length === 0 ? <Text dimColor>{t('noLimits')}</Text> : null}
        {paceLines.map(({ l, pace }) => (
          <Box flexDirection="column">
            <Svg
              source={limitSvg(l)}
              alt={t('altWeek', { kind: limitName(l.kind), p: l.percent, e: l.elapsed === undefined ? '?' : Math.round(l.elapsed) })}
            />
            {pace ? <Text color={l.runOutMs !== undefined ? 'red' : undefined}>{pace}</Text> : null}
          </Box>
        ))}
        {weekLine ? <Text>{weekLine}</Text> : null}
        {weekLine ? <Text dimColor>{totals ? t('totalsNote', { sub: totals.week.subUsd.toFixed(0) }) : t('totalsFallback')}</Text> : null}
        {scan.skipped > 0 ? <Text dimColor>{t('skipped', { n: scan.skipped })}</Text> : null}
        {gap}

        <Text bold>{t('effTitle')}</Text>
        {effs.length ? <Svg source={effSvg(effs, cfg)} alt={effs.map(x => t('altTurn', { n: x.n, eff: x.eff })).join(', ')} isInteractive /> : <Text dimColor>{noData}</Text>}
        <Text dimColor>
          {t('effLegend', { good: LEVEL_DOT.good, warn: LEVEL_DOT.warn, bad: LEVEL_DOT.bad, caution: cfg.effCaution, warnPct: cfg.effWarn })}
        </Text>
        {wasteLines.length ? <Text>{t('wasteHead', { min: k(cfg.wasteTokens) })}</Text> : null}
        {wasteLines.map(line => (
          <Text>{line}</Text>
        ))}
        {gap}

        <Text bold>{t('ctxTitle')}</Text>
        {list.length ? <Svg source={chartSvg(list)} alt={t('ctxAlt')} isInteractive /> : <Text dimColor>{noData}</Text>}
        {gap}

        <Text bold>{t('catTitle')}</Text>
        {cats.length ? <Svg source={catSvg(cats)} alt={cats.map(c => `${c.name} ${k(c.tokens)}`).join(', ')} isInteractive /> : <Text dimColor>{t('catNone')}</Text>}
      </Box>
    )
  })
}
