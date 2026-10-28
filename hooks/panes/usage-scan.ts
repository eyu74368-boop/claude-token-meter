// Today / last-7-days / this-week token totals across every transcript (all projects, subagents
// included). Pure: efficiency.tsx lists and reads `~/.claude/projects/**.jsonl` with `$.fs` and
// passes the text here.
//
// - spent = input + cache read + cache write + output (the same "processed tokens" the pane shows)
// - usd   = API price equivalent per million tokens (input/output): opus·fable 5/25, sonnet 3/15,
//   haiku 1/5; cache read 0.1x, cache write 5 min 1.25x, 1 h 2x. Unknown models use opus prices.
// - A message copied into a resumed transcript counts once (by message.id / uuid).

export type Total = { sessions: number; turns: number; spent: number; usd: number; subUsd: number }
export type Totals = { week: Total; today: Total; last7: Total }
export type Transcript = { name: string; mtimeMs: number; text: string }
/** One transcript reduced to what the totals need. `calls`: [message id, ms, spent, usd]; `turns`: [uuid, ms]. */
export type FileUsage = { name: string; isSub: boolean; calls: [string, number, number, number][]; turns: [string, number][] }
export type SumOptions = { weekStartMs?: number; todayStartMs?: number }

const DAY_MS = 86400000
const PRICES: [string, number, number][] = [
  ['opus', 5, 25],
  ['fable', 5, 25],
  ['sonnet', 3, 15],
  ['haiku', 1, 5],
]

const priceOf = (model: string): [number, number] => {
  const hit = PRICES.find(([name]) => model.includes(name)) ?? PRICES[0]!
  return [hit[1], hit[2]]
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : undefined)

/** Tokens processed by one API call and its price equivalent in USD. */
export function callCost(usage: Obj, model: string): { spent: number; usd: number } {
  const [pin, pout] = priceOf(model)
  const read = n(usage.cache_read_input_tokens)
  const write = n(usage.cache_creation_input_tokens)
  const w1h = Math.min(write, n(obj(usage.cache_creation)?.ephemeral_1h_input_tokens))
  const inp = n(usage.input_tokens)
  const out = n(usage.output_tokens)
  const usd = (inp * pin + read * pin * 0.1 + (write - w1h) * pin * 1.25 + w1h * pin * 2 + out * pout) / 1e6
  return { spent: inp + read + write + out, usd }
}

const isPrompt = (d: Obj): boolean => {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return false
  const c = obj(d.message)?.content
  return !(Array.isArray(c) && c.some(x => obj(x)?.type === 'tool_result'))
}

/** Transcripts under a `subagents` folder are subagent runs: their cost counts, their prompts are not turns. */
export const isSubagentPath = (name: string): boolean => /(^|[\\/])subagents([\\/]|$)/.test(name)

/** Reduces one transcript to its API calls and user prompts. Broken or partial lines are skipped. */
export function parseTranscript(name: string, text: string): FileUsage {
  const isSub = isSubagentPath(name)
  const out: FileUsage = { name, isSub, calls: [], turns: [] }
  for (const raw of text.split('\n')) {
    if (!raw.includes('"usage"') && !raw.includes('"user"')) continue
    let d: Obj | undefined
    try {
      d = obj(JSON.parse(raw))
    } catch {
      continue
    }
    if (!d) continue
    const ms = typeof d.timestamp === 'string' ? Date.parse(d.timestamp) : NaN
    if (!Number.isFinite(ms)) continue
    const m = obj(d.message)
    const u = obj(m?.usage)
    if (d.type === 'assistant' && u && typeof m?.id === 'string' && m.id) {
      const { spent, usd } = callCost(u, typeof m.model === 'string' ? m.model : '')
      if (spent > 0) out.calls.push([m.id, ms, spent, usd])
    } else if (!isSub && typeof d.uuid === 'string' && d.uuid && isPrompt(d)) {
      out.turns.push([d.uuid, ms])
    }
  }
  return out
}

const round2 = (v: number): number => Math.round(v * 100) / 100

/** Sums calls and prompts whose time is within [start, end], each message id / uuid once. */
export function totalOf(files: readonly FileUsage[], start: number, end: number): Total {
  const seenCalls = new Set<string>()
  const seenTurns = new Set<string>()
  const sessions = new Set<string>()
  const t: Total = { sessions: 0, turns: 0, spent: 0, usd: 0, subUsd: 0 }
  for (const f of files) {
    for (const [id, ms, spent, usd] of f.calls) {
      if (ms < start || ms > end || seenCalls.has(id)) continue
      seenCalls.add(id)
      t.spent += spent
      t.usd += usd
      if (f.isSub) t.subUsd += usd
    }
    for (const [id, ms] of f.turns) {
      if (ms < start || ms > end || seenTurns.has(id)) continue
      seenTurns.add(id)
      t.turns += 1
      sessions.add(f.name)
    }
  }
  t.sessions = sessions.size
  t.usd = round2(t.usd)
  t.subUsd = round2(t.subUsd)
  return t
}

/** Local midnight of the day `nowMs` falls on. */
export function localDayStart(nowMs: number): number {
  const d = new Date(nowMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Totals from already parsed files (efficiency.tsx caches the parse per file). */
export function sumParsed(files: readonly FileUsage[], nowMs: number, opts: SumOptions = {}): Totals {
  const end = nowMs + 60_000
  return {
    week: totalOf(files, opts.weekStartMs ?? nowMs - 7 * DAY_MS, end),
    today: totalOf(files, opts.todayStartMs ?? localDayStart(nowMs), end),
    last7: totalOf(files, nowMs - 7 * DAY_MS, end),
  }
}

/**
 * Totals for this week (from `weekStartMs`, else the last 7 days), today (from `todayStartMs`,
 * else local midnight) and the last 7 days. `undefined` when there is nothing to count.
 */
export function sumUsage(transcripts: readonly Transcript[], nowMs: number, opts: SumOptions = {}): Totals | undefined {
  if (transcripts.length === 0) return undefined
  return sumParsed(
    transcripts.map(t => parseTranscript(t.name, t.text)),
    nowMs,
    opts,
  )
}
